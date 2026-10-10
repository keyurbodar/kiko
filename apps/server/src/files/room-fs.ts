import { sha256Hex } from "@yuki/durable/hash"
import type { Context } from "@earendil-works/chord"
import {
  err,
  type ExecutionError,
  type ExecutionEnv,
  FileError,
  type FileErrorCode,
  type FileInfo,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLineReader,
} from "@earendil-works/pi-durable/env"
import type { ConversationId, ToolExecutionApi } from "@earendil-works/pi-durable"
import type { AgentSlug } from "@yuki/protocol"
import type { Env } from "../index"
import { roomStub, userStub } from "../lib/names"
import type { FsChange, FsEntry, FsFail } from "../room/files"
import type { AgentHome } from "../room/room-do"
import { runCommand } from "./bash"
import { cleanPath, deleteFiles, fileKey } from "./upload"
import type { CommitResult, IndexChange, NewFile } from "./file-index"

// The room's files as `pi-durable`'s `ExecutionEnv` (architecture section 18.1). Every agent in a
// room sees one file space, rooted at `/`. `pi-durable`'s own `read`, `write`, and `edit` run on it
// unchanged, and yuki's `ls`, `rm`, `mv`, and `cp` use the same object. Its shell is just-bash,
// an interpreter over these same files (files/bash.ts).
//
// Folders are real, as on Linux: mkdir makes one, writing `a/b/c.md` makes `a` and `a/b`, and an
// emptied folder stays. The R2 key comes from the agent's home, never from the model.
//
// One `RoomFs` per conversation. pi-durable builds a conversation's env at each use (`roomViews`), so
// an agent's run and each of its helpers has its own record of what it read. A write carries the hash
// this conversation last saw at the path, or "none" when it saw nothing there, so it never overwrites
// bytes it did not read: a teammate's, a helper's, or the human's. The room refuses it, and the agent
// reads and tries again.
//
// Speed. A stored object never changes (a write makes a new key), so bytes are cached by key with
// no invalidation: an `edit` right after a `read` fetches nothing from R2.

/** ASSUMPTION: the largest file an agent writes. */
export const MAX_WRITE_BYTES = 1024 * 1024
/** The chat's own file (section 7.10): what the chat is for. Read into every agent's prompt, so it stays short. */
export const CHAT_PATH = "chat.md"
/** ASSUMPTION: the longest /chat.md, in bytes. */
export const MAX_CHAT = 3_000
/** ASSUMPTION: bytes of R2 objects kept in memory per agent process. The object has 128 MB in all. */
const CACHE_BYTES = 4 * 1024 * 1024

/** What `RoomFs` needs from the room and R2. `roomBackend` binds it; tests use `memoryBackend`. */
export interface FilesBackend {
  stat(path: string): Promise<FsEntry | null>
  list(dir: string, recursive: boolean): Promise<FsEntry[] | FsFail>
  /** The object's bytes, or its first `maxBytes`. */
  bytes(r2Key: string, maxBytes?: number): Promise<Uint8Array | null>
  /** Stores bytes at a path. `expectSha256` is what the writer saw there: a hash, or "none". */
  write(path: string, bytes: Uint8Array, type: string, expectSha256: string): Promise<{ ok: true; entry: FsEntry & { kind: "file" } } | FsFail | { ok: false; code: "conflict"; message: string }>
  move(from: string, to: string): Promise<FsChange | FsFail>
  remove(paths: readonly string[], recursive: boolean): Promise<FsChange | FsFail>
  /** `mkdir -p`. */
  mkdir(path: string): Promise<FsChange | FsFail>
  /** A bash command's changes (section 18.4): within one file space, all of them or none. */
  commit(changes: readonly BatchChange[]): Promise<BatchResult>
}

/** One change of a command's commit, in backend paths, with the state it saw. A write carries its bytes. */
export type BatchChange =
  | { op: "write"; path: string; bytes: Uint8Array; type: string; expect: string }
  | { op: "move"; from: string; to: string; sha256: string }
  | { op: "remove"; path: string; sha256: string }
  | { op: "rmdir"; path: string; files: Readonly<Record<string, string>> }
  | { op: "mkdir"; path: string }

/** `conflict` when a path no longer held what the command saw. */
export type BatchResult = { ok: true } | { ok: false; path: string; message: string; conflict: boolean }

const batchPaths = (c: BatchChange) => (c.op === "move" ? [c.from, c.to] : [c.path])

const CODE: Record<string, FileErrorCode> = { not_found: "not_found", is_directory: "is_directory", not_directory: "not_directory", invalid: "invalid" }

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

/** The soul, the chat's skills, and its extensions reach every later system prompt. */
export const shapesPrompts = (rel: string): boolean => rel === SOUL_PATH || /^(skills|extensions)(\/|$)/.test(rel)

/**
 * A run that read outside content cannot change what shapes every later run (section 16.3). Returns
 * the one line the agent gets, or null.
 */
function promptGuard(rels: readonly string[], tainted: boolean): FileError | null {
  if (!tainted) return null
  const hit = rels.find(shapesPrompts)
  return hit === undefined ? null : new FileError("invalid", `/${hit} was not changed: this run read outside content, and that file shapes every later run. the human can ask you to change it.`, `/${hit}`)
}

export class RoomFs implements ExecutionEnv {
  readonly cwd = "/"
  /** The hash this conversation last read or wrote at each room path. */
  private readonly seen = new Map<string, string>()
  /**
   * Stats reused inside one `within` call, null for a missing path. pi's `read` checks a path exists
   * and then reads it, after yuki's `read` looked at it: one room call instead of three. Outside a
   * call every stat is fresh, so an edit always starts from what the room holds now.
   */
  private readonly stats = new Map<string, FsEntry | null>()
  private depth = 0

  constructor(
    /** pi-durable's file mutation queue keys on it, so every view of one agent shares it. */
    readonly id: string,
    private readonly backend: FilesBackend,
    /** Whether this conversation's run read outside content (section 16.3). */
    private readonly tainted: () => boolean = () => false,
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
    const memo = this.depth > 0
    const entry = memo && this.stats.has(rel.value) ? this.stats.get(rel.value)! : await this.backend.stat(rel.value)
    if (memo) this.stats.set(rel.value, entry)
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

  /** Bytes at a path. Refused when the path holds bytes this conversation did not read or write. */
  async write(path: string, bytes: Uint8Array, type = typeForPath(path)): Promise<Result<FsEntry & { kind: "file" }, FileError>> {
    const rel = this.roomPath(path)
    if (!rel.ok) return rel
    const refused = this.unwritable(rel.value, bytes.length, path)
    if (refused) return err(refused)
    const expect = this.seen.get(rel.value) ?? "none"
    const out = await this.backend.write(rel.value, bytes, type, expect)
    // A new file changes its folders too.
    this.stats.clear()
    if (!out.ok) {
      if (out.code !== "conflict") return err(this.fail(out, path))
      this.seen.delete(rel.value)
      const why =
        expect === "none"
          ? `${path} already exists, and you have not read it. read it, then write your change into what is there.`
          : `${path} changed since you last read it (a teammate, a helper, or the human edited it). read it again, then make your change.`
      return err(new FileError("unknown", why, path))
    }
    this.seen.set(rel.value, out.entry.sha256)
    return ok(out.entry)
  }

  /** Why `bytes` bytes cannot go at a room path, or null. */
  private unwritable(rel: string, bytes: number, path: string): FileError | null {
    if (rel === "") return new FileError("is_directory", "/ is a folder", path)
    const guarded = promptGuard([rel], this.tainted())
    if (guarded) return guarded
    if (rel === CHAT_PATH && bytes > MAX_CHAT) {
      return new FileError("invalid", `/chat.md would be ${bytes} bytes; it holds ${MAX_CHAT}, since every agent reads it each turn. tighten it: keep the goal, live decisions, and who does what.`, path)
    }
    if (bytes > MAX_WRITE_BYTES) return new FileError("invalid", `${path} would be ${bytes} bytes, over the ${MAX_WRITE_BYTES} byte limit`, path)
    return null
  }

  /**
   * A bash command's changes, in tool paths (section 18.4). Within each file space, all of them land
   * or none do. Every path and size is checked before anything is sent.
   */
  async commit(changes: readonly BatchChange[]): Promise<BatchResult> {
    const rel = (path: string) => {
      const out = this.roomPath(path)
      if (!out.ok) throw out.error
      return out.value
    }
    try {
      const mapped = changes.map((c): BatchChange => {
        switch (c.op) {
          case "write": {
            const path = rel(c.path)
            const refused = this.unwritable(path, c.bytes.length, c.path)
            if (refused) throw refused
            return { ...c, path }
          }
          case "move":
            return { ...c, from: rel(c.from), to: rel(c.to) }
          case "rmdir":
            return { ...c, path: rel(c.path), files: Object.fromEntries(Object.entries(c.files).map(([p, sha]) => [rel(p), sha])) }
          default:
            return { ...c, path: rel(c.path) }
        }
      })
      const guarded = promptGuard(mapped.flatMap(batchPaths), this.tainted())
      if (guarded) throw guarded
      const out = await this.backend.commit(mapped)
      this.stats.clear()
      return out.ok ? out : { ...out, path: `/${out.path}` }
    } catch (e) {
      if (e instanceof FileError) return { ok: false, path: e.path ?? "", message: e.message, conflict: false }
      throw e
    }
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
    const guarded = promptGuard([a.value, b.value], this.tainted())
    if (guarded) return err(guarded)
    const out = await this.backend.move(a.value, b.value)
    this.stats.clear()
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
    const guarded = promptGuard(rels, this.tainted())
    if (guarded) return err(guarded)
    const out = await this.backend.remove(rels, recursive)
    this.stats.clear()
    if (!out.ok) return err(this.fail(out))
    for (const rel of rels) this.seen.delete(rel)
    return ok(out)
  }

  /** Runs `fn` with stats reused across it. For one read-only tool call. */
  async within<T>(fn: () => Promise<T>): Promise<T> {
    this.depth++
    try {
      return await fn()
    } finally {
      if (--this.depth === 0) this.stats.clear()
    }
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

  /** `mkdir -p`: the folder and its parents. A folder that exists is fine. */
  async mkdir(path: string): Promise<Result<FsChange, FileError>> {
    const rel = this.roomPath(path)
    if (!rel.ok) return rel
    const guarded = promptGuard([rel.value], this.tainted())
    if (guarded) return err(guarded)
    const out = await this.backend.mkdir(rel.value)
    this.stats.clear()
    return out.ok ? ok(out) : err(this.fail(out, path))
  }

  async createDir(path: string): Promise<Result<void, FileError>> {
    const out = await this.mkdir(path)
    return out.ok ? ok(undefined) : out
  }

  async createTempDir(): Promise<Result<string, FileError>> {
    return err(new FileError("not_supported", "the chat's files have no temporary folders"))
  }

  async createTempFile(): Promise<Result<string, FileError>> {
    return err(new FileError("not_supported", "the chat's files have no temporary files"))
  }

  /** A bash command over these files, in just-bash (files/bash.ts). */
  async exec(command: string, options: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>> {
    return runCommand(this, command, options, context)
  }

  async cleanup(_context?: Context): Promise<void> {}
}

/**
 * One view of an agent's files per conversation, for pi-durable's `env` option, which builds a
 * conversation's env at each use. `tainted` reads that conversation's run.
 */
export function roomViews(id: string, backend: FilesBackend, tainted: (conversationId: ConversationId) => boolean): (conversationId: ConversationId) => RoomFs {
  const views = new Map<ConversationId, RoomFs>()
  return (conversationId) => {
    let view = views.get(conversationId)
    if (!view) views.set(conversationId, (view = new RoomFs(id, backend, () => tainted(conversationId))))
    return view
  }
}

/** The calling conversation's view of the chat's files: the env pi-durable built for this call. */
export function filesOf(api: Pick<ToolExecutionApi, "env">): RoomFs {
  if (api.env instanceof RoomFs) return api.env
  throw new Error("this agent has no chat files")
}

/** An LRU of immutable R2 objects by key. */
export class ObjectCache {
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

/** What one file space answers: a room's index in RoomDO, or the drive's in UserDO. */
type SpaceIndex = {
  /** The R2 key space: the room id, or `home`. */
  space: string
  stat(path: string): Promise<FsEntry | null>
  list(dir: string, recursive: boolean): Promise<FsEntry[] | FsFail>
  put(input: NewFile): Promise<{ drop: string | null; refused?: FsFail; conflict?: boolean; entry: FsEntry | null }>
  move(from: string, to: string): Promise<FsChange | FsFail>
  remove(paths: readonly string[], recursive: boolean): Promise<FsChange | FsFail>
  mkdir(path: string): Promise<FsChange | FsFail>
  commit(changes: readonly IndexChange[]): Promise<CommitResult>
}

/** A backend over one space's index and R2, with the shared byte cache. */
function spaceBackend(env: Env, home: () => AgentHome, index: () => SpaceIndex, cache: ObjectCache): FilesBackend {
  return {
    stat: (path) => index().stat(path),
    list: (dir, recursive) => index().list(dir, recursive),
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
      const h = home()
      const at = index()
      const id = crypto.randomUUID()
      const r2Key = fileKey(h.userId, at.space, id)
      const sha256 = await sha256Hex(bytes)
      await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: type } })
      const out = await at.put({ id, path, r2Key, size: bytes.length, type, sha256, author: { kind: "agent", slug: h.slug as AgentSlug }, expectSha256 })
      if (out.drop) await deleteFiles(env.FILES, out.drop)
      if (out.refused) return out.refused
      if (out.conflict) return { ok: false, code: "conflict", message: `${path} holds other bytes` }
      const entry = out.entry
      if (!entry || entry.kind !== "file") return { ok: false, code: "invalid", message: `could not store ${path}` }
      cache.set(entry.r2Key, bytes)
      return { ok: true, entry }
    },
    move: (from, to) => index().move(from, to),
    mkdir: (path) => index().mkdir(path),
    remove: (paths, recursive) => index().remove(paths, recursive),
    async commit(changes) {
      const h = home()
      const at = index()
      // The bytes go to R2 first, under new keys; the index then takes the whole batch or none of it.
      const stored: { key: string; bytes: Uint8Array }[] = []
      const indexed = await Promise.all(
        changes.map(async (c): Promise<IndexChange> => {
          if (c.op !== "write") return c.op === "move" ? { op: "move", from: c.from, to: c.to, sha256: c.sha256 } : c
          const id = crypto.randomUUID()
          const r2Key = fileKey(h.userId, at.space, id)
          const sha256 = await sha256Hex(c.bytes)
          await env.FILES.put(r2Key, c.bytes, { httpMetadata: { contentType: c.type } })
          stored.push({ key: r2Key, bytes: c.bytes })
          return { op: "put", file: { id, path: c.path, r2Key, size: c.bytes.length, type: c.type, sha256, author: { kind: "agent", slug: h.slug as AgentSlug }, expectSha256: c.expect } }
        }),
      )
      const out = await at.commit(indexed)
      if (!out.ok) {
        await deleteFiles(env.FILES, stored.map((s) => s.key))
        return out
      }
      for (const s of stored) cache.set(s.key, s.bytes)
      return { ok: true }
    },
  }
}

/** Throws until the room has told this agent where it lives. */
const homeOf = (home: () => AgentHome | null) => () => {
  const h = home()
  if (!h) throw new Error("this agent has no room yet")
  return h
}

/** The backend over the agent's own room and R2. `home` is read on every call: the room sets it. */
export function roomBackend(env: Env, home: () => AgentHome | null, cache = new ObjectCache()): FilesBackend {
  const h = homeOf(home)
  return spaceBackend(env, h, () => {
    const { userId, roomId, slug } = h()
    const room = roomStub(env.ROOM, userId, roomId)
    const me = slug as AgentSlug
    return {
      space: roomId,
      stat: (p) => room.fsStat(p),
      list: (d, r) => room.fsList(d, r),
      put: (input) => room.putFile(input),
      move: (a, b) => room.fsMove(me, a, b),
      remove: (p, r) => room.fsRemove(me, p, r),
      mkdir: (p) => room.fsMkdir(me, p),
      commit: (c) => room.fsCommit(me, c),
    }
  }, cache)
}

/**
 * The backend over the user's drive (section 18.3), in UserDO. Every change an agent makes there
 * is told to the chat through `notice`, so the human sees what landed in their drive.
 */
export function homeBackend(
  env: Env,
  home: () => AgentHome | null,
  notice: (text: string) => Promise<unknown>,
  cache = new ObjectCache(),
  /** Why the drive is read-only right now (a private chat), or null. */
  locked: () => string | null = () => null,
): FilesBackend {
  const h = homeOf(home)
  const told = async <T extends { ok: boolean }>(out: T, text: string) => {
    if (out.ok) await notice(text).catch(() => undefined)
    return out
  }
  const base = spaceBackend(env, h, () => {
    const { userId, slug } = h()
    const user = userStub(env.USER, userId)
    const me = { kind: "agent", slug: slug as AgentSlug } as const
    return {
      space: HOME_SPACE,
      stat: (p) => user.homeStat(p),
      list: (d, r) => user.homeList(d, r),
      put: (input) => user.homePut(input),
      move: (a, b) => user.homeMove(me, a, b),
      remove: (p, r) => user.homeRemove(me, p, r),
      mkdir: (p) => user.homeMkdir(me, p),
      commit: (c) => user.homeCommit(me, c),
    }
  }, cache)
  const refuse = (message: string): FsFail => ({ ok: false, code: "invalid", message })
  return {
    ...base,
    write: async (path, bytes, type, expect) => {
      const why = locked()
      return why ? refuse(why) : told(await base.write(path, bytes, type, expect), `saved /home/${path}`)
    },
    move: async (from, to) => {
      const why = locked()
      return why ? refuse(why) : told(await base.move(from, to), `moved /home/${from} to /home/${to}`)
    },
    remove: async (paths, recursive) => {
      const why = locked()
      return why ? refuse(why) : told(await base.remove(paths, recursive), `deleted ${paths.map((p) => `/home/${p}`).join(", ")}`)
    },
    mkdir: async (path) => {
      const why = locked()
      return why ? refuse(why) : base.mkdir(path)
    },
    commit: async (changes) => {
      const why = locked()
      if (why) return { ok: false, path: changes.flatMap(batchPaths)[0] ?? "", message: why, conflict: false }
      const out = await base.commit(changes)
      const said = changes.flatMap((c) =>
        c.op === "write" ? [`saved /home/${c.path}`] : c.op === "move" ? [`moved /home/${c.from} to /home/${c.to}`] : c.op === "mkdir" ? [] : [`deleted /home/${c.path}`],
      )
      return said.length ? told(out, said.join(", ")) : out
    },
  }
}

const HOME_SPACE = "home"
export const HOME_PATH = "home"

/**
 * Mounts `mounted` at /<at>: its paths gain the prefix, and the root lists it as a folder. A move
 * between the mount and the rest is refused, as `mv` across file systems would copy: use `cp`.
 */
export function withMount(base: FilesBackend, at: string, mounted: FilesBackend): FilesBackend {
  const inside = (p: string) => p === at || p.startsWith(`${at}/`)
  const strip = (p: string) => (p === at ? "" : p.slice(at.length + 1))
  const add = (e: FsEntry): FsEntry => ({ ...e, path: e.path ? `${at}/${e.path}` : at })
  const across: FsFail = { ok: false, code: "invalid", message: `moving between /${at} and the chat's files is not a move. cp it, then rm the original if you mean to` }
  return {
    async stat(path) {
      if (!inside(path)) return base.stat(path)
      const e = await mounted.stat(strip(path))
      return e ? add(e) : null
    },
    async list(dir, recursive) {
      if (inside(dir)) {
        const out = await mounted.list(strip(dir), recursive)
        return Array.isArray(out) ? out.map(add) : out
      }
      const out = await base.list(dir, recursive)
      if (dir !== "" || !Array.isArray(out)) return out
      const root = await mounted.stat("")
      const self: FsEntry = { kind: "directory", path: at, files: root?.kind === "directory" ? root.files : 0, size: root?.size ?? 0 }
      if (!recursive) return [self, ...out]
      const all = await mounted.list("", true)
      return [self, ...(Array.isArray(all) ? all.map(add) : []), ...out]
    },
    bytes: (key, max) => (key.includes(`/r/${HOME_SPACE}/`) ? mounted.bytes(key, max) : base.bytes(key, max)),
    async write(path, bytes, type, expect) {
      if (!inside(path)) return base.write(path, bytes, type, expect)
      if (path === at) return { ok: false, code: "is_directory", message: `/${at} is a folder` }
      const out = await mounted.write(strip(path), bytes, type, expect)
      return out.ok ? { ok: true, entry: add(out.entry) as FsEntry & { kind: "file" } } : out
    },
    async move(from, to) {
      if (inside(from) !== inside(to)) return across
      if (from === at) return { ok: false, code: "invalid", message: `/${at} stays where it is` }
      return inside(from) ? mounted.move(strip(from), strip(to)) : base.move(from, to)
    },
    async remove(paths, recursive) {
      if (paths.some((p) => p === at)) return { ok: false, code: "invalid", message: `/${at} cannot be deleted. delete what is in it instead` }
      const mine = paths.filter(inside)
      if (mine.length && mine.length !== paths.length) return { ok: false, code: "invalid", message: `delete /${at} paths and the chat's paths in separate calls` }
      return mine.length ? mounted.remove(mine.map(strip), recursive) : base.remove(paths, recursive)
    },
    async mkdir(path) {
      return inside(path) ? (path === at ? { ok: true, events: [], drop: [], changed: 0 } : mounted.mkdir(strip(path))) : base.mkdir(path)
    },
    async commit(changes) {
      // Each side is its own batch: the chat's files first, then the mount.
      const mine = (c: BatchChange) => batchPaths(c).every(inside)
      const crossing = changes.find((c) => !mine(c) && batchPaths(c).some(inside))
      if (crossing) return { ok: false, path: batchPaths(crossing)[0]!, message: across.message, conflict: false }
      const outside = changes.filter((c) => !mine(c))
      if (changes.some((c) => mine(c) && batchPaths(c).includes(at))) return { ok: false, path: at, message: `/${at} stays where it is`, conflict: false }
      const there = changes.filter(mine).map((c): BatchChange => {
        if (c.op === "move") return { ...c, from: strip(c.from), to: strip(c.to) }
        if (c.op === "rmdir") return { ...c, path: strip(c.path), files: Object.fromEntries(Object.entries(c.files).map(([p, sha]) => [strip(p), sha])) }
        return { ...c, path: strip(c.path) }
      })
      const first = outside.length ? await base.commit(outside) : ({ ok: true } as const)
      if (!first.ok || !there.length) return first
      const second = await mounted.commit(there)
      return second.ok ? second : { ...second, path: `${at}/${second.path}` }
    },
  }
}

/** The agent's own soul, as the mount at /me/soul.md reads and writes it (section 7.10). */
export interface SoulPort {
  get(): Promise<{ body: string; sha: string; at: number }>
  /** The soul for the system prompt, which may come from the run's start. Default `get`. */
  forPrompt?(): Promise<{ body: string }>
  set(body: string, expectSha: string): Promise<{ ok: true; soul: { body: string; sha: string; at: number } } | { ok: false; code: "conflict" | "invalid"; message: string }>
}

const ME = "me"
export const SOUL_PATH = "me/soul.md"

/**
 * The room's files with the agent's own folder mounted at /me. /me/soul.md is the agent's soul,
 * kept in UserDO and the same in every chat. pi's read, edit, and write work on it as on any file;
 * nothing else lives in /me, and it cannot be moved or deleted.
 */
export function withSoul(base: FilesBackend, soul: SoulPort): FilesBackend {
  const enc = new TextEncoder()
  const entry = async (): Promise<FsEntry & { kind: "file" }> => {
    const s = await soul.get()
    return { kind: "file", path: SOUL_PATH, id: "soul", size: enc.encode(s.body).length, type: "text/markdown", sha256: s.sha, r2Key: `soul:${s.sha}`, at: s.at }
  }
  const mine = (path: string) => path === ME || path.startsWith(`${ME}/`)
  const refuse = (message: string): FsFail => ({ ok: false, code: "invalid", message })
  return {
    async stat(path) {
      if (path === SOUL_PATH) return entry()
      if (path === ME) {
        const e = await entry()
        return { kind: "directory", path: ME, files: 1, size: e.size }
      }
      return mine(path) ? null : base.stat(path)
    },
    async list(dir, recursive) {
      if (dir === ME || dir === SOUL_PATH) return [await entry()]
      if (mine(dir)) return { ok: false, code: "not_found", message: `no such folder: /${dir}` }
      const out = await base.list(dir, recursive)
      if (dir !== "" || !Array.isArray(out)) return out
      const e = await entry()
      return recursive ? [e, ...out] : [{ kind: "directory", path: ME, files: 1, size: e.size }, ...out]
    },
    async bytes(r2Key, maxBytes) {
      if (!r2Key.startsWith("soul:")) return base.bytes(r2Key, maxBytes)
      const bytes = enc.encode((await soul.get()).body)
      return maxBytes === undefined ? bytes : bytes.subarray(0, maxBytes)
    },
    async write(path, bytes, type, expectSha256) {
      if (path !== SOUL_PATH) return mine(path) ? refuse("only /me/soul.md lives in /me") : base.write(path, bytes, type, expectSha256)
      // The soul always exists, so a write that read nothing there is a write over it.
      if (expectSha256 === "none") return { ok: false, code: "conflict", message: `${SOUL_PATH} holds other bytes` }
      const out = await soul.set(new TextDecoder().decode(bytes), expectSha256)
      if (!out.ok) return out.code === "conflict" ? { ok: false, code: "conflict", message: out.message } : refuse(out.message)
      return { ok: true, entry: await entry() }
    },
    async move(from, to) {
      return mine(from) || mine(to) ? refuse("/me/soul.md stays where it is. edit it instead") : base.move(from, to)
    },
    async remove(paths, recursive) {
      return paths.some(mine) ? refuse("/me/soul.md cannot be deleted. edit it instead") : base.remove(paths, recursive)
    },
    async mkdir(path) {
      return mine(path) ? refuse("only /me/soul.md lives in /me") : base.mkdir(path)
    },
    async commit(changes) {
      const other = changes.find((c) => batchPaths(c).some(mine) && !(c.op === "write" && c.path === SOUL_PATH))
      if (other) return { ok: false, path: batchPaths(other).find(mine)!, message: "/me/soul.md stays where it is, and only it lives in /me. edit it instead", conflict: false }
      const rest = changes.filter((c) => !batchPaths(c).some(mine))
      const first = rest.length ? await base.commit(rest) : ({ ok: true } as const)
      const write = changes.find((c) => c.op === "write" && c.path === SOUL_PATH)
      if (!first.ok || write?.op !== "write") return first
      const out = await soul.set(new TextDecoder().decode(write.bytes), write.expect)
      return out.ok ? { ok: true } : { ok: false, path: SOUL_PATH, message: out.message, conflict: out.code === "conflict" }
    },
  }
}
