import { existsSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "@effect/vitest"
import type { Policy } from "./config"
import { Deadline } from "./deadline"
import { Fail } from "./log"
import { read, shell, write } from "./ops"

const CANCELLED = new Fail({ code: "cancelled", message: "the agent cancelled this call" })

async function workspace(): Promise<{ dir: string; policy: Policy }> {
  const dir = await mkdtemp(join(tmpdir(), "kiko-ops-"))
  return { dir, policy: { shell: true, files: { allow: [dir] }, desktop: false, live: false, input: false } }
}

function cancelled(): Deadline {
  const deadline = new Deadline(60_000)
  deadline.controller.abort(CANCELLED)
  return deadline
}

describe("a cancelled call", () => {
  it("leaves no file behind", async () => {
    const { dir, policy } = await workspace()
    const path = join(dir, "note.txt")

    await expect(write({ path, text: "hello" }, policy, cancelled())).rejects.toBe(CANCELLED)

    expect(existsSync(path)).toBe(false)
  })

  it("reads nothing", async () => {
    const { dir, policy } = await workspace()
    const path = join(dir, "note.txt")
    await writeFile(path, "hello")

    await expect(read({ path }, policy, cancelled())).rejects.toBe(CANCELLED)
  })

  it("runs no shell command", async () => {
    const { dir, policy } = await workspace()
    const path = join(dir, "touched.txt")

    await expect(shell({ command: `touch ${path}` }, policy, cancelled())).rejects.toBe(CANCELLED)

    expect(existsSync(path)).toBe(false)
  })
})

describe("a live call", () => {
  it("still writes and reads", async () => {
    const { dir, policy } = await workspace()
    const path = join(dir, "note.txt")
    const deadline = new Deadline(60_000)

    expect(await write({ path, text: "hello" }, policy, deadline)).toEqual({ size: 5 })
    expect(await read({ path }, policy, deadline)).toMatchObject({ text: "hello", truncated: false })
  })
})
