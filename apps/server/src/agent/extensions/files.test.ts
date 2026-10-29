import { describe, expect, it } from "vitest"
import type { Context } from "@earendil-works/chord"
import type { ConversationId, ToolExecutionApi } from "@earendil-works/pi-durable"
import { type FilesBackend, RoomFs } from "../../files/room-fs"
import type { FsEntry } from "../../files/file-index"
import { filesExtension } from "./files"

type Stored = { bytes: Uint8Array; type: string }

function memoryFs(seed: Record<string, string | Uint8Array>) {
  const files = new Map<string, Stored>(
    Object.entries(seed).map(([p, v]) => [
      p,
      { bytes: typeof v === "string" ? new TextEncoder().encode(v) : v, type: "text/plain" },
    ]),
  )
  const reads: (number | undefined)[] = []
  const entry = (path: string, f: Stored): FsEntry & { kind: "file" } => ({
    kind: "file",
    path,
    id: path,
    size: f.bytes.length,
    type: f.type,
    sha256: String(f.bytes.length),
    r2Key: path,
    at: 0,
  })
  const done = { ok: true as const, events: [], drop: [], changed: 1 }
  const missing = (path: string) => ({
    ok: false as const,
    code: "not_found" as const,
    message: `no such file or folder: ${path}`,
  })
  const backend: FilesBackend = {
    stat: async (path) => {
      const f = files.get(path)
      return f ? entry(path, f) : path === "" ? { kind: "directory", path, files: files.size, size: 0 } : null
    },
    list: async () => [...files].map(([p, f]) => entry(p, f)),
    bytes: async (key, max) => {
      reads.push(max)
      return files.get(key)?.bytes.slice(0, max) ?? null
    },
    write: async (path, bytes, type) => {
      files.set(path, { bytes, type })
      return { ok: true, entry: entry(path, { bytes, type }) }
    },
    move: async (from, to) => {
      const f = files.get(from)
      if (!f) return missing(from)
      files.delete(from)
      files.set(to, f)
      return done
    },
    remove: async (paths) => {
      const absent = paths.find((path) => !files.has(path))
      if (absent !== undefined) return missing(absent)
      for (const path of paths) files.delete(path)
      return { ...done, changed: paths.length }
    },
    mkdir: async () => done,
    commit: async () => ({ ok: true }),
  }
  return { fs: new RoomFs("test", backend), reads }
}

const touched: string[][] = []
const tools =
  filesExtension({ acceptsImages: () => false, touched: (_, paths) => touched.push([...paths]) }).tools ?? []
const tool = (name: string) => {
  const found = tools.find((t) => t.name === name)
  if (!found) throw new Error(`no ${name} tool`)
  return found
}
const apiOf = (fs: RoomFs) =>
  ({
    env: fs,
    conversationId: 0 as ConversationId,
    agent: async () => ({ model: undefined }),
  }) as unknown as ToolExecutionApi
const context = {} as Context
const textOf = (out: { output?: readonly { type: string; text?: string }[] }) =>
  (out.output ?? []).map((o) => o.text ?? "").join("")

describe("read", () => {
  it("numbers each line from the offset", async () => {
    const { fs } = memoryFs({ "notes.md": "one\ntwo\nthree\n" })
    const out = await tool("read").execute({ path: "/notes.md", offset: 2 }, apiOf(fs), context)
    expect(textOf(out)).toBe("2\ttwo\n3\tthree\n")
  })

  it("refuses a binary file after reading only its start", async () => {
    const bytes = new Uint8Array(100_000)
    const { fs, reads } = memoryFs({ "blob.dat": bytes })
    const out = await tool("read").execute({ path: "/blob.dat" }, apiOf(fs), context)
    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("binary file")
    expect(reads.every((max) => max !== undefined && max < bytes.length)).toBe(true)
  })
})

describe("edit", () => {
  it("says why a change was refused", async () => {
    const { fs } = memoryFs({ "chat.md": "goal: x" })
    const edit = tool("edit").execute(
      { path: "/chat.md", edits: [{ oldText: "x", newText: "y".repeat(4000) }] },
      apiOf(fs),
      context,
    )
    await expect(edit).rejects.toThrow(/it holds 3000/)
  })

  it("keeps the diff and marks the file touched", async () => {
    const { fs } = memoryFs({ "notes.md": "one\n" })
    touched.length = 0
    const out = await tool("edit").execute(
      { path: "/notes.md", edits: [{ oldText: "one", newText: "two" }] },
      apiOf(fs),
      context,
    )
    expect((out.details as { diff?: string }).diff).toContain("two")
    expect(touched).toEqual([["/notes.md"]])
  })
})

describe("rm", () => {
  it("treats every path already gone as done, so a rerun reports success", async () => {
    const { fs } = memoryFs({ "a.txt": "one" })
    const first = await tool("rm").execute({ paths: ["/a.txt"] }, apiOf(fs), context)
    expect(textOf(first)).toBe("deleted 1 file")
    const again = await tool("rm").execute({ paths: ["/a.txt"] }, apiOf(fs), context)
    expect(again.isError).toBeFalsy()
    expect(textOf(again)).toBe("nothing to delete")
  })

  it("still deletes nothing when one path of several is missing", async () => {
    const { fs } = memoryFs({ "a.txt": "one", "b.txt": "two" })
    await expect(tool("rm").execute({ paths: ["/a.txt", "/missing.txt"] }, apiOf(fs), context)).rejects.toThrow(
      /missing/,
    )
    expect((await tool("read").execute({ path: "/a.txt" }, apiOf(fs), context)).isError).toBeFalsy()
  })
})

describe("mv", () => {
  it("treats a source already moved as done, so a rerun reports success", async () => {
    const { fs } = memoryFs({ "a.txt": "one" })
    const first = await tool("mv").execute({ from: "/a.txt", to: "/b.txt" }, apiOf(fs), context)
    expect(textOf(first)).toBe("moved /a.txt to b.txt")
    const again = await tool("mv").execute({ from: "/a.txt", to: "/b.txt" }, apiOf(fs), context)
    expect(again.isError).toBeFalsy()
    expect(textOf(again)).toBe("moved /a.txt to b.txt")
  })
})
