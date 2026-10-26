import { describe, expect, it } from "vitest"
import type { Context } from "@earendil-works/chord"
import { sha256Hex } from "@kiko/durable/hash"
import type { OwnerServices } from "../owner/services"
import type { AgentHome } from "../room/room-do"
import type { FsEntry } from "./file-index"
import type { BatchChange } from "./batch"
import { MAX_TIMEOUT_S } from "./bash"
import { type FilesBackend, HomeNotices, homeBackend, RoomFs } from "./room-fs"

type Stored = { bytes: Uint8Array; sha256: string; type: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function memoryBackend(beforeCommit: () => Promise<void> = async () => {}) {
  const files = new Map<string, Stored>()
  const entry = (path: string, f: Stored): FsEntry & { kind: "file" } => ({
    kind: "file",
    path,
    id: path,
    size: f.bytes.length,
    type: f.type,
    sha256: f.sha256,
    r2Key: path,
    at: 0,
  })
  const inside = (dir: string, path: string) => dir === "" || path.startsWith(`${dir}/`)
  const folders = () => {
    const out = new Set<string>()
    for (const path of files.keys())
      for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) out.add(path.slice(0, i))
    return out
  }
  const folder = (path: string): FsEntry => ({ kind: "directory", path, files: 0, size: 0 })
  const put = async (path: string, bytes: Uint8Array, type: string) => {
    const stored = { bytes, sha256: await sha256Hex(bytes), type }
    files.set(path, stored)
    return stored
  }
  const shaOf = (path: string) => files.get(path)?.sha256 ?? "none"
  const done = { ok: true as const, events: [], drop: [], changed: 1 }
  const backend: FilesBackend = {
    stat: async (path) => {
      const f = files.get(path)
      if (f) return entry(path, f)
      return path === "" || folders().has(path) ? folder(path) : null
    },
    list: async (dir, recursive) => {
      const below = (p: string) => inside(dir, p) && (recursive || !p.slice(dir ? dir.length + 1 : 0).includes("/"))
      return [
        ...[...folders()].filter(below).map(folder),
        ...[...files].filter(([p]) => below(p)).map(([p, f]) => entry(p, f)),
      ]
    },
    bytes: async (key, max) => files.get(key)?.bytes.slice(0, max) ?? null,
    write: async (path, bytes, type, expect) => {
      if (shaOf(path) !== expect) return { ok: false, code: "conflict", message: `${path} holds other bytes` }
      return { ok: true, entry: entry(path, await put(path, bytes, type)) }
    },
    move: async (from, to) => {
      const f = files.get(from)
      if (!f) return { ok: false, code: "not_found", message: `no ${from}` }
      files.delete(from)
      files.set(to, f)
      return done
    },
    remove: async (paths) => {
      for (const p of paths) files.delete(p)
      return done
    },
    mkdir: async () => done,
    commit: async (changes: readonly BatchChange[]) => {
      await beforeCommit()
      for (const c of changes)
        if (c.op === "write" && shaOf(c.path) !== c.expect)
          return { ok: false, path: c.path, message: `${c.path} holds other bytes`, conflict: true }
      for (const c of changes) {
        if (c.op === "write") await put(c.path, c.bytes, c.type)
        if (c.op === "move") await backend.move(c.from, c.to)
        if (c.op === "remove") files.delete(c.path)
      }
      return { ok: true }
    },
  }
  return { backend, files, put }
}

async function bash(fs: RoomFs, command: string, timeout?: number) {
  let output = ""
  const out = await fs.exec(
    command,
    { onOutput: (text) => void (output += text), ...(timeout ? { timeout } : {}) },
    {} as Context,
  )
  if (!out.ok) throw out.error
  return { exitCode: out.value.exitCode, changed: out.value.changed, output }
}

describe("RoomFs", () => {
  it("lets the agent write over a file its own bash command changed", async () => {
    const { backend } = memoryBackend()
    const fs = new RoomFs("test", backend)
    expect((await bash(fs, "echo one > /notes.md")).changed).toEqual(["/notes.md"])
    const out = await fs.write("/notes.md", encoder.encode("two\n"))
    expect(out.ok).toBe(true)
  })

  it("runs a script the agent wrote as ./script.sh", async () => {
    const { backend, files } = memoryBackend()
    const fs = new RoomFs("test", backend)
    const out = await bash(fs, "printf 'echo ran\\n' > /run.sh; echo kept > /kept.txt; cd / && ./run.sh")
    expect(out.exitCode).toBe(0)
    expect(out.output).toContain("ran")
    expect(decoder.decode(files.get("kept.txt")?.bytes)).toBe("kept\n")
  })

  it("matches a negated bracket in a case pattern", async () => {
    const { backend } = memoryBackend()
    const fs = new RoomFs("test", backend)
    const check = (n: string) =>
      bash(fs, `n=${n}; case "$n" in ''|*[!0-9]*) echo word;; *) echo number;; esac`).then((o) => o.output.trim())
    expect(await check("12")).toBe("number")
    expect(await check("ab")).toBe("word")
  })

  it("saves nothing when a command hits a limit", async () => {
    const { backend, files } = memoryBackend()
    const fs = new RoomFs("test", backend)
    const out = await bash(fs, "echo lost > /lost.txt; f(){ f; }; f")
    expect(out.exitCode).toBe(126)
    expect(out.output).toContain("hit a limit")
    expect(files.has("lost.txt")).toBe(false)
  })

  it("says when it caps a requested timeout", async () => {
    const fs = new RoomFs("test", memoryBackend().backend)
    expect((await bash(fs, "true", MAX_TIMEOUT_S + 1)).output).toContain(`at most ${MAX_TIMEOUT_S} seconds`)
    expect((await bash(fs, "true", 60)).output).toBe("")
  })

  it("says a conflicting file changed since the command started", async () => {
    let race = async () => {}
    const { backend, put } = memoryBackend(() => race())
    const fs = new RoomFs("test", backend)
    await bash(fs, "echo one > /notes.md")
    race = async () => {
      await put("notes.md", encoder.encode("other\n"), "text/markdown")
    }
    const out = await bash(fs, "echo two > /notes.md")
    expect(out.output).toContain("/notes.md changed after this command started")
    expect(out.output).not.toContain("teammate")
  })
})

function homeServices() {
  const objects = new Map<string, Uint8Array>()
  const bucket = {
    put: async (key: string, bytes: Uint8Array) => void objects.set(key, bytes),
    get: async (key: string) => {
      const bytes = objects.get(key)
      return bytes ? { arrayBuffer: async () => bytes.buffer } : null
    },
    delete: async (keys: readonly string[]) => {
      for (const k of keys) objects.delete(k)
    },
  }
  const done = { ok: true as const, events: [], drop: [], changed: 1 }
  const user = {
    homePut: async (input: { path: string; r2Key: string; size: number; type: string; sha256: string }) => ({
      drop: null,
      entry: { kind: "file", id: input.path, at: 0, ...input },
    }),
    homeMove: async () => done,
    homeRemove: async () => done,
    homeMkdir: async () => done,
    homeCommit: async () => ({ ok: true, events: [], drop: [] }),
  }
  return { files: () => bucket, user: () => user } as unknown as OwnerServices
}

describe("homeBackend", () => {
  const home = () => ({ roomId: "room", slug: "juno", userId: "owner" }) as unknown as AgentHome
  const write = (path: string) => ({
    op: "write" as const,
    path,
    bytes: encoder.encode("x"),
    type: "text/plain",
    expect: "none",
  })

  it("gathers a run's changes to /home into one notice", async () => {
    const notices = new HomeNotices()
    const backend = homeBackend(homeServices(), home, notices)
    await backend.write("a.md", encoder.encode("a"), "text/markdown", "none")
    await backend.write("a.md", encoder.encode("b"), "text/markdown", "none")
    await backend.commit([write("b.md"), { op: "remove", path: "c.md", sha256: "x" }])
    expect(notices.take()).toBe("saved /home/a.md, saved /home/b.md, deleted /home/c.md")
    expect(notices.take()).toBeNull()
  })

  it("cuts a long list of changes short", async () => {
    const notices = new HomeNotices()
    const backend = homeBackend(homeServices(), home, notices)
    await backend.commit(Array.from({ length: 12 }, (_, i) => write(`f${i}.md`)))
    const said = notices.take() ?? ""
    expect(said.split(", saved").length).toBe(6)
    expect(said.endsWith("and 6 more")).toBe(true)
  })

  it("says nothing about a refused write", async () => {
    const notices = new HomeNotices()
    const backend = homeBackend(homeServices(), home, notices, undefined, () => "this chat is private")
    await backend.write("a.md", encoder.encode("a"), "text/markdown", "none")
    expect(notices.take()).toBeNull()
  })
})
