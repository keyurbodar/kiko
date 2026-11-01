import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { planJobs, readConfig } from "../config"
import { createMachine, removeMachine } from "../machine"
import { TASKS } from "../tasks"
import type { Contender, Machine, Os, Task } from "../types"
import { withHarness } from "./harness"
import { CONTENDERS } from "./index"

const CONFIG = fileURLToPath(new URL("../../baseline.json", import.meta.url))

const TOOLS_AFTER_START: Readonly<Record<string, readonly string[]>> = { "kiko-remote": ["computer_read"] }

const READERS = ["read_file", "computer_read", "shell"]

const FILE_MENTION = /\b[\w-]+\.(?:txt|json|jsonl|csv|tsv|md|ya?ml|log|sh|py)\b/

const machines: Machine[] = []

afterEach(async () => {
  await Promise.all(machines.splice(0).map((machine) => removeMachine(machine)))
})

const surface = (contender: Contender): readonly string[] => [
  ...contender.tools().map((tool) => tool.name),
  ...(TOOLS_AFTER_START[contender.name] ?? []),
]

const pick = (track: string, os: string, contender: string): Task[] =>
  TASKS.filter(
    (task) =>
      task.track === track && task.os.includes(os as Os) && (!task.contenders || task.contenders.includes(contender)),
  )

const bare = (): Contender => ({
  name: "bare",
  version: "0",
  tracks: ["browser"],
  start: async () => undefined,
  tools: () => [],
  call: async () => ({ text: "nothing here", images: [], isError: true }),
  stop: async () => undefined,
})

describe("harness file tools", () => {
  it("lets every contender the plan runs read the files a prompt names", () => {
    const jobs = planJobs(readConfig(CONFIG), [...TASKS])
    const pairs: string[] = []
    const missing: string[] = []
    for (const job of jobs) {
      const build = CONTENDERS[job.contender]
      if (!build) throw new Error(`the plan names ${job.contender}, which the registry does not have`)
      const names = new Set(surface(build()))
      for (const task of pick(job.track, job.os, job.contender)) {
        if (!FILE_MENTION.test(task.prompt)) continue
        pairs.push(`${task.id} × ${job.contender}`)
        if (!READERS.some((reader) => names.has(reader))) missing.push(`${task.id} × ${job.contender}`)
      }
    }
    expect(pairs.length).toBeGreaterThan(0)
    expect([...new Set(missing)]).toEqual([])
  })

  it("reads and lists inside the working directory and refuses to leave it", async () => {
    const machine = await createMachine("test-harness")
    machines.push(machine)
    await machine.writeText(join(machine.workdir, "request.json"), '{"name":"ada"}\n')
    const contender = withHarness(bare())
    await contender.start(machine, "foreground")
    const signal = new AbortController().signal

    expect(contender.tools().map((tool) => tool.name)).toEqual(["read_file", "list_files"])

    const read = await contender.call("read_file", { path: "request.json" }, signal)
    expect(read.isError).toBe(false)
    expect(read.text).toBe('{"name":"ada"}\n')

    const listed = await contender.call("list_files", {}, signal)
    expect(listed.isError).toBe(false)
    expect(listed.text).toContain("request.json")

    const missing = await contender.call("read_file", { path: "url.txt" }, signal)
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain("is not in the working directory")

    const outside = await contender.call("read_file", { path: "../etc/hostname" }, signal)
    expect(outside.isError).toBe(true)
    expect(outside.text).toContain("outside the working directory")

    await contender.stop()
  })

  it("keeps the inner contender's own tools if it already has one by that name", async () => {
    const inner: Contender = { ...bare(), tools: () => [{ name: "read_file", description: "own", parameters: {} }] }
    const contender = withHarness(inner)
    expect(contender.tools().map((tool) => tool.name)).toEqual(["read_file", "list_files"])
    expect(contender.tools().find((tool) => tool.name === "read_file")?.description).toBe("own")
  })
})
