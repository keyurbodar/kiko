import { expect, test } from "bun:test"
import { kikoDocsBackend, KIKO } from "../src/files/kiko-docs"
import { type BatchChange, type FilesBackend, RoomFs, withMount } from "../src/files/room-fs"
import type { FsEntry, FsFail } from "../src/room/files"
import { KIKO_DOCS } from "../src/agent/kiko-docs.gen"

const empty: FilesBackend = {
  stat: async () => null,
  list: async () => [],
  bytes: async () => null,
  write: async () => ({ ok: false, code: "invalid", message: "the chat's files are empty in this test" }),
  move: async () => ({ ok: false, code: "invalid", message: "nothing to move" }) as FsFail,
  remove: async () => ({ ok: false, code: "invalid", message: "nothing to remove" }) as FsFail,
  mkdir: async () => ({ ok: false, code: "invalid", message: "nothing to make" }) as FsFail,
  commit: async () => ({ ok: false, path: "", message: "nothing to save", conflict: false }),
}

const fs = () => new RoomFs("kiko-docs-test", withMount(empty, KIKO, kikoDocsBackend()))

test("every page is readable at /kiko/<file>", async () => {
  const files = fs()
  const listed = await files.listDir("/kiko")
  expect(listed.ok).toBe(true)
  const names = listed.ok ? listed.value.map((e) => e.name).sort() : []
  expect(names).toEqual(KIKO_DOCS.map(([name]) => name).sort())
  for (const [name] of KIKO_DOCS) {
    const read = await files.readTextFile(`/kiko/${name}`)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value).toStartWith("# ")
  }
})

test("the folder is listed at the root so the agent finds it", async () => {
  const out = await fs().listDir("/")
  expect(out.ok && out.value.map((e) => e.name)).toContain(KIKO)
})

test("a write to /kiko fails with one clear sentence and saves nothing", async () => {
  const files = fs()
  const write = await files.write("/kiko/index.md", new TextEncoder().encode("mine now"))
  expect(write.ok).toBe(false)
  if (!write.ok) {
    expect(write.error.message).toContain("/kiko is read-only")
    expect(write.error.message).toContain("Write your own files under / or /home")
  }
  const batch = await files.commit([{ op: "write", path: "/kiko/new.md", bytes: new TextEncoder().encode("x"), type: "text/markdown", expect: "none" } satisfies BatchChange])
  expect(batch.ok).toBe(false)
  expect((await files.readTextFile("/kiko/index.md")).ok).toBe(true)
})

test("removing or making a folder in /kiko fails", async () => {
  const files = fs()
  expect((await files.remove("/kiko/index.md")).ok).toBe(false)
  expect((await files.mkdir("/kiko/more")).ok).toBe(false)
})

test("a path inside /kiko but not a page is not found", async () => {
  const files = fs()
  const read = await files.readTextFile("/kiko/nope.md")
  expect(read.ok).toBe(false)
  if (!read.ok) expect(read.error.message).toContain("no such file")
  const stat: FsEntry | null = (await kikoDocsBackend().stat("nope.md")) as FsEntry | null
  expect(stat).toBeNull()
})
