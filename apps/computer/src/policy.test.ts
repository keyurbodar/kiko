import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import type { Policy } from "./config"
import { allowedPath } from "./policy"

const policy = (allow: string[]): Policy => ({
  shell: true,
  files: { allow },
  desktop: true,
  live: true,
  input: true,
})

async function sandbox(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "kiko-policy-")))
}

describe("allowed path", () => {
  it("accepts a path inside an allowed root and returns it resolved", async () => {
    const base = await sandbox()
    try {
      const root = join(base, "root")
      await mkdir(root)
      assert.strictEqual(allowedPath(policy([root]), join(root, "note.txt")), join(root, "note.txt"))
      assert.strictEqual(allowedPath(policy([root]), root), root)
      assert.isNull(allowedPath(policy([root]), join(base, "outside.txt")))
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it("refuses a path that leaves an allowed root through a symlink", async () => {
    const base = await sandbox()
    try {
      const root = join(base, "root")
      const outside = join(base, "outside")
      await mkdir(root)
      await mkdir(outside)
      await writeFile(join(outside, "secret.txt"), "secret")
      await symlink(outside, join(root, "link"))
      await symlink(join(outside, "secret.txt"), join(root, "secret.txt"))

      assert.isNull(allowedPath(policy([root]), join(root, "link", "secret.txt")))
      assert.isNull(allowedPath(policy([root]), join(root, "secret.txt")))
      assert.isNull(allowedPath(policy([root]), join(base, "link-that-does-not-exist", "x.txt")))
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it("follows a symlinked root so its real contents stay allowed", async () => {
    const base = await sandbox()
    try {
      const root = join(base, "root")
      await mkdir(root)
      await writeFile(join(root, "note.txt"), "note")
      await symlink(root, join(base, "alias"))

      assert.strictEqual(allowedPath(policy([join(base, "alias")]), join(root, "note.txt")), join(root, "note.txt"))
      assert.strictEqual(allowedPath(policy([root]), join(base, "alias", "note.txt")), join(root, "note.txt"))
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
