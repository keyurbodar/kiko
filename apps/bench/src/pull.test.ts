import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { COLUMNS, toTsv, type Row } from "./ledger"
import { appendIndex, harvestArtifacts, INDEX_HEADER } from "./pull"

const dirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function rowOf(runId: string, machine: string, trial: string): Row {
  const base = Object.fromEntries(COLUMNS.map((column) => [column, ""])) as Record<string, string | number>
  return {
    ...base,
    run_id: runId,
    trial_id: trial,
    machine,
    commit: "abc1234",
    task: "terminal-001-count-matches",
    outcome: "done",
    pass: 1,
  } as Row
}

async function artifact(staging: string, name: string, runId: string, machine: string, trials = 2): Promise<void> {
  const dir = join(staging, name)
  await mkdir(join(dir, runId), { recursive: true })
  const rows = Array.from({ length: trials }, (_, index) => rowOf(runId, machine, `t${index + 1}`))
  await writeFile(join(dir, `${runId}.tsv`), toTsv(rows), "utf8")
  await writeFile(join(dir, runId, "t1.json"), "{}", "utf8")
}

describe("pull", () => {
  it("copies each artifact's ledger and trajectories into the results dir", async () => {
    const staging = await tempDir("bench-staging-")
    const plans = await tempDir("bench-plans-")
    await artifact(staging, "bench-ubuntu-24.04", "run-a", "gha-ubuntu")
    await artifact(staging, "bench-macos-15", "run-b", "gha-macos", 3)
    const appended = await harvestArtifacts(staging, plans, "123")
    expect(appended).toEqual(["run-b\t123\tgha-macos\tabc1234\t3", "run-a\t123\tgha-ubuntu\tabc1234\t2"])
    expect(existsSync(join(plans, "run-a.tsv"))).toBe(true)
    expect(existsSync(join(plans, "run-a", "t1.json"))).toBe(true)
    expect(existsSync(join(plans, "run-b.tsv"))).toBe(true)
  })

  it("reads an artifact that kept a results/ folder", async () => {
    const staging = await tempDir("bench-staging-")
    const plans = await tempDir("bench-plans-")
    await artifact(staging, "bench-linux", "run-c", "gha-linux", 1)
    await mkdir(join(staging, "bench-linux", "results"), { recursive: true })
    await writeFile(
      join(staging, "bench-linux", "results", "run-c.tsv"),
      toTsv([rowOf("run-c", "gha-linux", "t1")]),
      "utf8",
    )
    const appended = await harvestArtifacts(staging, plans, "9")
    expect(appended).toHaveLength(1)
    expect(appended[0]).toContain("run-c\t9\tgha-linux")
  })

  it("does not append the same run and machine twice", async () => {
    const staging = await tempDir("bench-staging-")
    const plans = await tempDir("bench-plans-")
    await artifact(staging, "bench-ubuntu", "run-a", "gha-ubuntu")
    await appendIndex(plans, await harvestArtifacts(staging, plans, "1"))
    expect(await harvestArtifacts(staging, plans, "1")).toEqual([])
    const index = await readFile(join(plans, "index.tsv"), "utf8")
    expect(index.split("\n")[0]).toBe(INDEX_HEADER)
    expect(index.trim().split("\n")).toHaveLength(2)
  })

  it("ignores validation ledgers", async () => {
    const staging = await tempDir("bench-staging-")
    const plans = await tempDir("bench-plans-")
    const dir = join(staging, "bench-ubuntu")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "validate-run.tsv"), "task\tos\tmachine\tkind\tpass\tdetail\n", "utf8")
    expect(await harvestArtifacts(staging, plans, "1")).toEqual([])
  })
})
