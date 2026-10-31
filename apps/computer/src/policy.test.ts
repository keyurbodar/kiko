import { assert, describe, it } from "@effect/vitest"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Policy } from "./config"
import { allowedPath } from "./policy"

const policy = (...allow: string[]): Policy => ({
  shell: false,
  files: { allow },
  desktop: false,
  live: false,
  input: false,
})

type Space = { root: string; allowed: string; outside: string }

async function space(): Promise<Space> {
  const root = await mkdtemp(join(tmpdir(), "kiko-policy-"))
  const allowed = join(root, "allowed")
  const outside = join(root, "outside")
  await mkdir(allowed)
  await mkdir(outside)
  return { root, allowed, outside }
}

describe("file policy", () => {
  it("allows a file inside an allowed root", async () => {
    const { root, allowed } = await space()
    try {
      const file = join(allowed, "note.txt")
      await writeFile(file, "hi")
      assert.strictEqual(allowedPath(policy(allowed), file), await realpath(file))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("allows a path that does not exist yet inside an allowed root", async () => {
    const { root, allowed } = await space()
    try {
      const target = join(allowed, "new", "deep", "note.txt")
      assert.strictEqual(allowedPath(policy(allowed), target), join(await realpath(allowed), "new", "deep", "note.txt"))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("denies a path that does not exist yet outside the allowed roots", async () => {
    const { root, allowed, outside } = await space()
    try {
      assert.isNull(allowedPath(policy(allowed), join(outside, "note.txt")))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("allows a file reached through a symlinked allow root", async () => {
    const { root, allowed } = await space()
    try {
      const alias = join(root, "alias")
      await symlink(allowed, alias)
      const file = join(allowed, "note.txt")
      await writeFile(file, "hi")
      assert.strictEqual(allowedPath(policy(alias), file), await realpath(file))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")("denies a symlinked directory that leaves the allowed root", async () => {
    const { root, allowed, outside } = await space()
    try {
      await writeFile(join(outside, "secret.txt"), "secret")
      await symlink(outside, join(allowed, "link"))
      assert.isNull(allowedPath(policy(allowed), join(allowed, "link", "secret.txt")))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")("denies a symlinked file that leaves the allowed root", async () => {
    const { root, allowed, outside } = await space()
    try {
      const secret = join(outside, "secret.txt")
      await writeFile(secret, "secret")
      await symlink(secret, join(allowed, "secret-link"))
      assert.isNull(allowedPath(policy(allowed), join(allowed, "secret-link")))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === "win32")(
    "denies a dangling symlink that points outside the allowed root",
    async () => {
      const { root, allowed, outside } = await space()
      try {
        await symlink(join(outside, "new.txt"), join(allowed, "new-link"))
        assert.isNull(allowedPath(policy(allowed), join(allowed, "new-link")))
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it.skipIf(process.platform === "win32")("denies a symlink loop", async () => {
    const { root, allowed } = await space()
    try {
      await symlink(join(allowed, "loop"), join(allowed, "loop"))
      assert.isNull(allowedPath(policy(allowed), join(allowed, "loop")))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
