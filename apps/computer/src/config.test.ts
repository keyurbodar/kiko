import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { policyCache } from "./config"

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kiko-policy-"))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("policy cache", () => {
  it("reads the file once and hands back the same policy while it is unchanged", async () => {
    const dir = await tempDir()
    await writeFile(join(dir, "policy.json"), JSON.stringify({ shell: true, desktop: true }))
    const policy = policyCache(dir)

    const first = await policy()
    const second = await policy()

    expect(first.shell).toBe(true)
    expect(second).toBe(first)
  })

  it("reads the file again when it changes", async () => {
    const dir = await tempDir()
    const file = join(dir, "policy.json")
    await writeFile(file, JSON.stringify({ shell: true, desktop: true }))
    const policy = policyCache(dir)
    const first = await policy()

    await writeFile(file, JSON.stringify({ shell: false }))

    const next = await policy()
    expect(next).not.toBe(first)
    expect(next.shell).toBe(false)
    expect(next.desktop).toBe(true)
  })
})
