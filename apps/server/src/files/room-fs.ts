import type { Context } from "@earendil-works/chord"
import {
  err,
  ExecutionError,
  type ExecutionEnv,
  FileError,
  type FileErrorCode,
  type FileInfo,
  ok,
  type Result,
  type ShellExecResult,
  type TextLineReader,
} from "@earendil-works/pi-durable/env"
import type { AgentSlug } from "@kiko/protocol"
import type { Env } from "../index"
import { roomStub } from "../lib/names"
import type { FsChange, FsEntry, FsFail } from "../room/files"
import type { AgentHome } from "../room/room-do"
import { cleanPath, fileKey } from "./upload"

// The room's files as `pi-durable`'s `ExecutionEnv` (architecture section 18.1). Every agent in a
// room sees one file space, rooted at `/`. `pi-durable`'s own `read`, `write`, and `edit` run on it
// unchanged, and kiko's `ls`, `rm`, `mv`, and `cp` use the same object. There is no shell.
//
// Folders are path prefixes, as in R2: a folder exists while it holds a file, and writing
// `a/b/c.md` makes `a` and `a/b`. The R2 key comes from the agent's home, never from the model.
//
// Speed. A stored object never changes (a write makes a new key), so bytes are cached by key with
// no invalidation: an `edit` right after a `read` fetches nothing from R2. Each write carries the
// hash of the bytes this agent last saw at the path, so an edit never overwrites a teammate's change
// it did not read; the room refuses it and the agent reads again.

/** ASSUMPTION: the largest file an agent writes. */
export const MAX_WRITE_BYTES = 1024 * 1024
/** ASSUMPTION: bytes of R2 objects kept in memory per agent process. The object has 128 MB in all. */
const CACHE_BYTES = 4 * 1024 * 1024

/** What `RoomFs` needs from the room and R2. `roomBackend` binds it; tests use `memoryBackend`. */
export interface FilesBackend {
  stat(path: string): Promise<FsEntry | null>
  list(dir: string, recursive: boolean): Promise<FsEntry[] | FsFail>
  /** The object's bytes, or its first `maxBytes`. */
  bytes(r2Key: string, maxBytes?: number): Promise<Uint8Array | null>
  /** Stores bytes at a path. `expectSha256` is the precondition: "none" for a path that must be empty. */
  write(path: string, bytes: Uint8Array, type: string, expectSha256?: string): Promise<{ ok: true; entry: FsEntry & { kind: "file" } } | FsFail | { ok: false; code: "conflict"; message: string }>
  move(from: string, to: string): Promise<FsChange | FsFail>
  remove(paths: readonly string[], recursive: boolean): Promise<FsChange | FsFail>
}

const CODE: Record<string, FileErrorCode> = { not_found: "not_found", is_directory: "is_directory", not_directory: "not_directory", invalid: "invalid" }

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("")

/** Resolves `.` and `..` against `/`. Null when the path climbs above the root. */
export function normalize(path: string, cwd = "/"): string | null {
  const parts: string[] = []
  for (const part of (path.startsWith("/") ? path : `${cwd}/${path}`).split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  return `/${parts.join("/")}`
}

const MIME_BY_EXTENSION: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  py: "text/x-python",
  svg: "image/svg+xml",
  xml: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
}

/** The type a written text file is stored with, from its extension. */
export function typeForPath(path: string): string {
  const dot = path.lastIndexOf(".")
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot + 1).toLowerCase() : ""
  return MIME_BY_EXTENSION[ext] ?? "text/plain"
}

export class RoomFs implements ExecutionEnv {
  readonly cwd = "/"
  /** The hash this agent last read or wrote at each room path. */
  private readonly seen = new Map<string, string>()

  constructor(
    readonly id: string,
    private readonly backend: FilesBackend,
  ) {}

  /** The room path (no leading slash) of a tool path, or a refusal. */
  roomPath(path: string): Result<string, FileError> {
    const abs = normalize(path, this.cwd)
    if (abs === null) return err(new FileError("invalid", `${path} is outside the chat's files`, path))
    const rel = abs.slice(1)
    if (rel !== "" && cleanPath(rel) === null) return err(new FileError("invalid", `${path} is not a valid path`, path))
    return ok(rel)
  }

  private fail(f: FsFail | { code: string; message: string }, path?: string): FileError {
    return new FileError(CODE[f.code] ?? "unknown", f.message, path)
  }

  async stat(path: string): Promise<Result<FsEntry, FileError>> {
    const rel = this.roomPath(path)
    if (!rel.ok) return rel
    const entry = await this.backend.stat(rel.value)
    return entry ? ok(entry) : err(new FileError("not_found", `no such file or folder: ${path}`, path))
  }

  async absolutePath(path: string): Promise<Result<string, FileError>> {
    const rel = this.roomPath(path)
    return rel.ok ? ok(`/${rel.value}`) : rel
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    const joined = normalize(parts.join("/"), this.cwd)
    return joined === null ? err(new FileError("invalid", "the path climbs above the chat's files")) : ok(joined)
  }

  /** No links: a path is its own canonical form. Saves a room call on every edit. */
  async canonicalPath(path: string): Promise<Result<string, FileError>> {
    return this.absolutePath(path)
  }

  async readBinaryFile(path: string): Promise<Result<Uint8Array, FileError>> {
    const found = await this.stat(path)
    if (!found.ok) return found
    const entry = found.value
    if (entry.kind === "directory") return err(new FileError("is_directory", `${path} is a folder`, path))
    const bytes = await this.backend.bytes(entry.r2Key)
    if (!bytes) return err(new FileError("not_found", `no such file: ${path}`, path))
    this.seen.set(entry.path, entry.sha256)
    return ok(bytes)
  }

  async readTextFile(path: string): Promise<Result<string, FileError>> {
    const bytes = await this.readBinaryFile(path)
    return bytes.ok ? ok(new TextDecoder().decode(bytes.value)) : bytes
  }

  async readTextLines(path: string, options: { maxLines?: number } | undefined): Promise<Result<string[], FileError>> {
    const text = await this.readTextFile(path)
    if (!text.ok) return text
    const lines = text.value.split("\n")
    return ok(options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines))
  }

  async openTextLineReader(path: string): Promise<Result<TextLineReader, FileError>> {
    const text = await this.readTextFile(path)
    if (!text.ok) return text
    const lines = text.value.split("\n")
    let i = 0
    return ok({
      readLine: async () => (i < lines.length ? ok({ text: lines[i]!, terminated: i++ < lines.length - 1 }) : ok(undefined)),
      close: async () => {},
    })
  }

  /** Bytes at a path. Refused when another writer changed the file since this agent last saw it. */
  async write(path: string, bytes: Uint8Array, type = typeForPath(path)): Promise<Result<FsEntry & { kind: "file" }, FileError>> {
    const rel = this.roomPath(path)
    if (!rel.ok) return rel
    if (rel.value === "") return err(new FileError("is_directory", "/ is a folder", path))
    if (bytes.length > MAX_WRITE_BYTES) return err(new FileError("invalid", `${path} would be ${bytes.length} bytes, over the ${MAX_WRITE_BYTES} byte limit`, path))
    const out = await this.backend.write(rel.value, bytes, type, this.seen.get(rel.value))
    if (!out.ok) {
      if (out.code === "conflict") this.seen.delete(rel.value)
      return err(out.code === "conflict" ? new FileError("unknown", out.message, path) : this.fail(out, path))
    }
    this.seen.set(rel.value, out.entry.sha256)
    return ok(out.entry)
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    const out = await this.write(path, typeof content === "string" ? new TextEncoder().encode(content) : content)
    return out.ok ? ok(undefined) : out
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    const before = await this.readBinaryFile(path)
    if (!before.ok && before.error.code !== "not_found") return before
    const add = typeof content === "string" ? new TextEncoder().encode(content) : content
    const head = before.ok ? before.value : new Uint8Array()
    const joined = new Uint8Array(head.length + add.length)
    joined.set(head)
    joined.set(add, head.length)
    return this.writeFile(path, joined)
  }

  async truncateFile(path: string, size: number): Promise<Result<void, FileError>> {
    const before = await this.readBinaryFile(path)
    if (!before.ok) return before
    const out = new Uint8Array(size)
    out.set(before.value.subarray(0, size))
    return this.writeFile(path, out)
  }

  async flushFile(): Promise<Result<void, FileError>> {
    return ok(undefined)
  }

  async move(from: string, to: string): Promise<Result<FsChange, FileError>> {
    const a = this.roomPath(from)
    if (!a.ok) return a
    const b = this.roomPath(to)
    if (!b.ok) return b
    const out = await this.backend.move(a.value, b.value)
    return out.ok ? ok(out) : err(this.fail(out, from))
  }

  async renameFile(sourcePath: string, destinationPath: string): Promise<Result<void, FileError>> {
    const out = await this.move(sourcePath, destinationPath)
    return out.ok ? ok(undefined) : out
  }

  async remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined): Promise<Result<void, FileError>> {
    const out = await this.removeAll([path], options?.recursive ?? false)
    if (!out.ok && options?.force && out.error.code === "not_found") return ok(undefined)
    return out.ok ? ok(undefined) : out
  }

  async removeAll(paths: readonly string[], recursive: boolean): Promise<Result<FsChange, FileError>> {
    const rels: string[] = []
    for (const p of paths) {
      const rel = this.roomPath(p)
      if (!rel.ok) return rel
      rels.push(rel.value)
    }
    const out = await this.backend.remove(rels, recursive)
    if (!out.ok) return err(this.fail(out))
    for (const rel of rels) this.seen.delete(rel)
    return ok(out)
  }

  async list(path: string, recursive = false): Promise<Result<FsEntry[], FileError>> {
    const rel = this.roomPath(path)
    if (!rel.ok) return rel
    const out = await this.backend.list(rel.value, recursive)
    return Array.isArray(out) ? ok(out) : err(this.fail(out, path))
  }

  /** The bytes of an entry this agent listed or statted. */
  async bytesOf(entry: FsEntry & { kind: "file" }, maxBytes?: number): Promise<Uint8Array | null> {
    return this.backend.bytes(entry.r2Key, maxBytes)
  }

  private info(e: FsEntry): FileInfo {
    const name = e.path.slice(e.path.lastIndexOf("/") + 1)
    return { name, path: `/${e.path}`, kind: e.kind, size: e.size, mtimeMs: e.kind === "file" ? e.at : 0 }
  }

  async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
    const found = await this.stat(path)
    return found.ok ? ok(this.info(found.value)) : found
  }

  async listDir(path: string): Promise<Result<FileInfo[], FileError>> {
    const out = await this.list(path)
    return out.ok ? ok(out.value.map((e) => this.info(e))) : out
  }

  async exists(path: string): Promise<Result<boolean, FileError>> {
    const found = await this.stat(path)
    if (found.ok) return ok(true)
    return found.error.code === "not_found" ? ok(false) : found
  }

  /** Folders exist while they hold files, so making one changes nothing. */
  async createDir(path: string): Promise<Result<void, FileError>> {
    const found = await this.stat(path)
    if (found.ok && found.value.kind === "file") return err(new FileError("not_directory", `${path} is a file`, path))
    return found.ok || found.error.code === "not_found" ? ok(undefined) : found
  }

  async createTempDir(): Promise<Result<string, FileError>> {
    return err(new FileError("not_supported", "the chat's files have no temporary folders"))
  }

  async createTempFile(): Promise<Result<string, FileError>> {
    return err(new FileError("not_supported", "the chat's files have no temporary files"))
  }

  async exec(): Promise<Result<ShellExecResult, ExecutionError>> {
    return err(new ExecutionError("shell_unavailable", "there is no shell. use the file tools."))
  }

  async cleanup(_context?: Context): Promise<void> {}
}

/** An LRU of immutable R2 objects by key. */
class ObjectCache {
  private readonly items = new Map<string, Uint8Array>()
  private bytes = 0

  get(key: string): Uint8Array | undefined {
    const hit = this.items.get(key)
    if (hit) {
      this.items.delete(key)
      this.items.set(key, hit)
    }
    return hit
  }

  set(key: string, value: Uint8Array): void {
    if (value.length > CACHE_BYTES / 4 || this.items.has(key)) return
    this.items.set(key, value)
    this.bytes += value.length
    for (const [k, v] of this.items) {
      if (this.bytes <= CACHE_BYTES) break
      this.items.delete(k)
      this.bytes -= v.length
    }
  }
}

/** The backend over the agent's own room and R2. `home` is read on every call: the room sets it. */
export function roomBackend(env: Env, home: () => AgentHome | null): FilesBackend {
  const cache = new ObjectCache()
  const where = () => {
    const h = home()
    if (!h) throw new Error("this agent has no room yet")
    return { home: h, room: roomStub(env.ROOM, h.userId, h.roomId) }
  }
  return {
    stat: (path) => where().room.fsStat(path),
    list: (dir, recursive) => where().room.fsList(dir, recursive),
    async bytes(r2Key, maxBytes) {
      const hit = cache.get(r2Key)
      if (hit) return maxBytes === undefined ? hit : hit.subarray(0, maxBytes)
      const object = await env.FILES.get(r2Key, maxBytes === undefined ? undefined : { range: { offset: 0, length: maxBytes } })
      if (!object) return null
      const bytes = new Uint8Array(await object.arrayBuffer())
      if (maxBytes === undefined) cache.set(r2Key, bytes)
      return bytes
    },
    async write(path, bytes, type, expectSha256) {
      const { home: h, room } = where()
      const id = crypto.randomUUID()
      const r2Key = fileKey(h.userId, h.roomId, id)
      const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes))
      await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: type } })
      const out = await room.putFile({ id, path, r2Key, size: bytes.length, type, sha256, author: { kind: "agent", slug: h.slug as AgentSlug }, ...(expectSha256 ? { expectSha256 } : {}) })
      if (out.drop) await env.FILES.delete(out.drop)
      if (out.refused) return out.refused
      if (out.conflict) return { ok: false, code: "conflict", message: `${path} changed since you last read it (a teammate or the human edited it). read it again, then make your change.` }
      const entry = out.entry
      if (!entry || entry.kind !== "file") return { ok: false, code: "invalid", message: `could not store ${path}` }
      cache.set(entry.r2Key, bytes)
      return { ok: true, entry }
    },
    move: (from, to) => where().room.fsMove(where().home.slug as AgentSlug, from, to),
    remove: (paths, recursive) => where().room.fsRemove(where().home.slug as AgentSlug, paths, recursive),
  }
}
