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

    const first = await policy.get()
    const second = await policy.get()

    expect(first.shell).toBe(true)
    expect(second).toBe(first)
  })

  it("reads the file again when it changes", async () => {
    const dir = await tempDir()
    const file = join(dir, "policy.json")
    await writeFile(file, JSON.stringify({ shell: true, desktop: true }))
    const policy = policyCache(dir)
    const first = await policy.get()

    await writeFile(file, JSON.stringify({ shell: false }))

    const next = await policy.get()
    expect(next).not.toBe(first)
    expect(next.shell).toBe(false)
    expect(next.desktop).toBe(true)
  })

  it("hands the live path a new policy once its window passes", async () => {
    const dir = await tempDir()
    const file = join(dir, "policy.json")
    await writeFile(file, JSON.stringify({ live: true, input: true }))
    let clock = 0
    const policy = policyCache(dir, () => clock)
    expect(policy.current().live).toBe(true)

    await writeFile(file, JSON.stringify({ live: false, input: false }))
    expect(policy.current().live).toBe(true)

    clock = 1_000
    expect(policy.current().live).toBe(false)
  })
})
