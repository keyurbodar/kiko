import { sha256Hex } from "@kiko/durable/hash"
import type { Context } from "@earendil-works/chord"
import {
  type BinaryReader,
  type DirReader,
  err,
  type ExecutionError,
  type ExecutionEnv,
  FileError,
  type FileErrorCode,
  type FileInfo,
  type FileWatcher,
  LineScanner,
  ok,
  type Result,
  type ShellExecOptions,
  type TextLineReader,
  type WatchChange,
  type WatchTarget,
} from "@earendil-works/pi-durable/env"
import type { ConversationId, ToolExecutionApi } from "@earendil-works/pi-durable"
import type { AgentSlug } from "@kiko/protocol"
import type { OwnerServices } from "../owner/services"
import type { FsChange, FsEntry, FsFail } from "../room/files"
import type { AgentHome } from "../room/room-do"
import { type BashResult, runCommand } from "./bash"
import { cleanPath, deleteFiles, fileKey, HOME } from "./paths"
import { type BatchChange, batchPaths, typeForPath } from "./batch"
import { baseName, type CommitResult, type IndexChange, type NewFile } from "./file-index"

export const CHAT_PATH = "chat.md"
export const MAX_CHAT = 3_000
const MAX_WRITE_BYTES = 1024 * 1024
const CACHE_BYTES = 4 * 1024 * 1024

function normalize(path: string, cwd = "/"): string | null {
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

export interface FilesBackend {
  stat(path: string): Promise<FsEntry | null>
  list(dir: string, recursive: boolean): Promise<FsEntry[] | FsFail>
  bytes(r2Key: string, maxBytes?: number): Promise<Uint8Array | null>
  write(
    path: string,
    bytes: Uint8Array,
    type: string,
    expectSha256: string,
  ): Promise<
    { ok: true; entry: FsEntry & { kind: "file" } } | FsFail | { ok: false; code: "conflict"; message: string }
  >
  move(from: string, to: string): Promise<FsChange | FsFail>
  remove(paths: readonly string[], recursive: boolean): Promise<FsChange | FsFail>
  mkdir(path: string): Promise<FsChange | FsFail>
  commit(changes: readonly BatchChange[]): Promise<BatchResult>
}

export type BatchResult = { ok: true } | { ok: false; path: string; message: string; conflict: boolean }

const CODE: Record<string, FileErrorCode> = {
  not_found: "not_found",
  is_directory: "is_directory",
  not_directory: "not_directory",
  invalid: "invalid",
}

export class RoomFs implements ExecutionEnv {
  readonly cwd = "/"
  private readonly seen = new Map<string, string>()
  private readonly stats = new Map<string, FsEntry | null>()
  private depth = 0

  constructor(
    readonly id: string,
    private readonly backend: FilesBackend,
  ) {}

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
    const cached = memo ? this.stats.get(rel.value) : undefined
    const entry = cached !== undefined ? cached : await this.backend.stat(rel.value)
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
      readLine: async () => {
        const line = lines[i]
        if (line === undefined) return ok(undefined)
        return ok({ text: line, terminated: i++ < lines.length - 1 })
      },
      close: async () => {},
    })
  }

  async openBinaryReader(path: string): Promise<Result<BinaryReader, FileError>> {
    const found = await this.stat(path)
    if (!found.ok) return found
    if (found.value.kind === "directory") return err(new FileError("is_directory", `${path} is a folder`, path))
    const bytes = await this.readBinaryFile(path)
    if (!bytes.ok) return bytes
    const data = bytes.value
    const info = this.info(found.value)
    return ok({
      info: async () => ok({ ...info, size: data.length }),
      read: async (offset, length) => ok(data.slice(offset, offset + length)),
      scanLines: async (options) => {
        let scanner: LineScanner
        try {
          scanner = new LineScanner(options.startLine, options.endLine)
        } catch {
          return err(new FileError("invalid", "Invalid line range", path))
        }
        scanner.push(data)
        return ok(scanner.finish())
      },
      close: async () => {},
    })
  }

  async openDirReader(path: string): Promise<Result<DirReader, FileError>> {
    const listed = await this.listDir(path)
    if (!listed.ok) return listed
    const entries = listed.value
    let next = 0
    return ok({
      next: async (maxEntries) => {
        const page = entries.slice(next, next + maxEntries)
        next += page.length
        return ok({ entries: page, done: next >= entries.length })
      },
      close: async () => {},
    })
  }

  async watch(
    _targets: readonly WatchTarget[],
    _onChange: (change: WatchChange) => void,
  ): Promise<Result<FileWatcher, FileError>> {
    return err(new FileError("not_supported", "the chat's files cannot be watched"))
  }

  async write(
    path: string,
    bytes: Uint8Array,
    type = typeForPath(path),
  ): Promise<Result<FsEntry & { kind: "file" }, FileError>> {
    const rel = this.roomPath(path)
    if (!rel.ok) return rel
    const refused = this.unwritable(rel.value, bytes.length, path)
    if (refused) return err(refused)
    const expect = this.seen.get(rel.value) ?? "none"
    const out = await this.backend.write(rel.value, bytes, type, expect)
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

  private unwritable(rel: string, bytes: number, path: string): FileError | null {
    if (rel === "") return new FileError("is_directory", "/ is a folder", path)
    if (rel === CHAT_PATH && bytes > MAX_CHAT) {
      return new FileError(
        "invalid",
        `/chat.md would be ${bytes} bytes; it holds ${MAX_CHAT}, since every agent reads it each turn. tighten it: keep the goal, live decisions, and who does what.`,
        path,
      )
    }
    if (bytes > MAX_WRITE_BYTES)
      return new FileError("invalid", `${path} would be ${bytes} bytes, over the ${MAX_WRITE_BYTES} byte limit`, path)
    return null
  }

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
            return {
              ...c,
              path: rel(c.path),
              files: Object.fromEntries(Object.entries(c.files).map(([p, sha]) => [rel(p), sha])),
            }
          default:
            return { ...c, path: rel(c.path) }
        }
      })
      const out = await this.backend.commit(mapped)
      this.stats.clear()
      if (out.ok)
        for (const c of mapped)
          for (const p of c.op === "rmdir" ? [c.path, ...Object.keys(c.files)] : batchPaths(c)) this.seen.delete(p)
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

  async move(from: string, to: string): Promise<Result<FsChange & { to: string }, FileError>> {
    const a = this.roomPath(from)
    if (!a.ok) return a
    const b = this.roomPath(to)
    if (!b.ok) return b
    const dest = await this.stat(to)
    const into = dest.ok && dest.value.kind === "directory"
    const target = into ? [b.value, baseName(a.value)].filter(Boolean).join("/") : b.value
    const out = await this.backend.move(a.value, b.value)
    this.stats.clear()
    this.seen.delete(a.value)
    this.seen.delete(b.value)
    return out.ok ? ok({ ...out, to: `/${target}` }) : err(this.fail(out, from))
  }

  async renameFile(sourcePath: string, destinationPath: string): Promise<Result<void, FileError>> {
    const out = await this.move(sourcePath, destinationPath)
    return out.ok ? ok(undefined) : out
  }

  async remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
  ): Promise<Result<void, FileError>> {
    const out = await this.removeAll([path], options?.recursive ?? false)
    if (!out.ok && options?.force && out.error.code === "not_found") return ok(undefined)
    return out.ok ? ok(undefined) : out
  }

  async removeAll(
    paths: readonly string[],
    recursive: boolean,
  ): Promise<Result<FsChange & { paths: string[] }, FileError>> {
    const rels: string[] = []
    for (const p of paths) {
      const rel = this.roomPath(p)
      if (!rel.ok) return rel
      rels.push(rel.value)
    }
    const out = await this.backend.remove(rels, recursive)
    this.stats.clear()
    if (!out.ok) return err(this.fail(out))
    for (const rel of rels) this.seen.delete(rel)
    return ok({ ...out, paths: rels.map((rel) => `/${rel}`) })
  }

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

  async mkdir(path: string): Promise<Result<FsChange, FileError>> {
    const rel = this.roomPath(path)
    if (!rel.ok) return rel
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

  async exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<BashResult, ExecutionError>> {
    const line =
      typeof command === "string" ? command : command.map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(" ")
    return runCommand(this, line, options, context)
  }

  async cleanup(_context?: Context): Promise<void> {}
}

export function roomViews(id: string, backend: FilesBackend): (conversationId: ConversationId) => RoomFs {
  const views = new Map<ConversationId, RoomFs>()
  return (conversationId) => {
    let view = views.get(conversationId)
    if (!view) {
      view = new RoomFs(id, backend)
      views.set(conversationId, view)
    }
    return view
  }
}

export function filesOf(api: Pick<ToolExecutionApi, "env">): RoomFs {
  if (api.env instanceof RoomFs) return api.env
  throw new Error("this agent has no chat files")
}

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

type SpaceIndex = {
  space: string
  stat(path: string): Promise<FsEntry | null>
  list(dir: string, recursive: boolean): Promise<FsEntry[] | FsFail>
  put(input: NewFile): Promise<{ drop: string | null; refused?: FsFail; conflict?: boolean; entry: FsEntry | null }>
  move(from: string, to: string): Promise<FsChange | FsFail>
  remove(paths: readonly string[], recursive: boolean): Promise<FsChange | FsFail>
  mkdir(path: string): Promise<FsChange | FsFail>
  commit(changes: readonly IndexChange[]): Promise<CommitResult>
}

function spaceBackend(
  services: OwnerServices,
  home: () => AgentHome,
  index: () => SpaceIndex,
  cache: ObjectCache,
): FilesBackend {
  return {
    stat: (path) => index().stat(path),
    list: (dir, recursive) => index().list(dir, recursive),
    async bytes(r2Key, maxBytes) {
      const hit = cache.get(r2Key)
      if (hit) return maxBytes === undefined ? hit : hit.subarray(0, maxBytes)
      const object = await services
        .files()
        .get(r2Key, maxBytes === undefined ? undefined : { range: { offset: 0, length: maxBytes } })
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
      await services.files().put(r2Key, bytes, { httpMetadata: { contentType: type } })
      const out = await at.put({
        id,
        path,
        r2Key,
        size: bytes.length,
        type,
        sha256,
        author: { kind: "agent", slug: h.slug as AgentSlug },
        expectSha256,
      })
      if (out.drop) await deleteFiles(services.files(), out.drop)
      if (out.refused || out.conflict) {
        await deleteFiles(services.files(), [r2Key])
        return out.refused ?? { ok: false, code: "conflict", message: `${path} holds other bytes` }
      }
      const entry = out.entry
      if (entry?.kind !== "file") return { ok: false, code: "invalid", message: `could not store ${path}` }
      cache.set(entry.r2Key, bytes)
      return { ok: true, entry }
    },
    move: (from, to) => index().move(from, to),
    mkdir: (path) => index().mkdir(path),
    remove: (paths, recursive) => index().remove(paths, recursive),
    async commit(changes) {
      const h = home()
      const at = index()
      const stored: { key: string; bytes: Uint8Array }[] = []
      const indexed = await Promise.all(
        changes.map(async (c): Promise<IndexChange> => {
          if (c.op !== "write") return c
          const id = crypto.randomUUID()
          const r2Key = fileKey(h.userId, at.space, id)
          const sha256 = await sha256Hex(c.bytes)
          await services.files().put(r2Key, c.bytes, { httpMetadata: { contentType: c.type } })
          stored.push({ key: r2Key, bytes: c.bytes })
          return {
            op: "put",
            file: {
              id,
              path: c.path,
              r2Key,
              size: c.bytes.length,
              type: c.type,
              sha256,
              author: { kind: "agent", slug: h.slug as AgentSlug },
              expectSha256: c.expect,
            },
          }
        }),
      )
      const out = await at.commit(indexed)
      if (!out.ok) {
        await deleteFiles(
          services.files(),
          stored.map((s) => s.key),
        )
        return out
      }
      for (const s of stored) cache.set(s.key, s.bytes)
      return { ok: true }
    },
  }
}

const homeOf = (home: () => AgentHome | null) => () => {
  const h = home()
  if (!h) throw new Error("this agent has no room yet")
  return h
}

export function roomBackend(
  services: OwnerServices,
  home: () => AgentHome | null,
  cache = new ObjectCache(),
): FilesBackend {
  const h = homeOf(home)
  return spaceBackend(
    services,
    h,
    () => {
      const { roomId, slug } = h()
      const room = services.room(roomId)
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
    },
    cache,
  )
}

export function homeBackend(
  services: OwnerServices,
  home: () => AgentHome | null,
  notice: (text: string) => Promise<unknown>,
  cache = new ObjectCache(),
  locked: () => string | null = () => null,
): FilesBackend {
  const h = homeOf(home)
  const told = async <T extends { ok: boolean }>(out: T, text: string) => {
    if (out.ok) await notice(text).catch(() => undefined)
    return out
  }
  const base = spaceBackend(
    services,
    h,
    () => {
      const { slug } = h()
      const user = services.user()
      const me = { kind: "agent", slug: slug as AgentSlug } as const
      return {
        space: HOME,
        stat: (p) => user.homeStat(p),
        list: (d, r) => user.homeList(d, r),
        put: (input) => user.homePut(input),
        move: (a, b) => user.homeMove(me, a, b),
        remove: (p, r) => user.homeRemove(me, p, r),
        mkdir: (p) => user.homeMkdir(me, p),
        commit: (c) => user.homeCommit(me, c),
      }
    },
    cache,
  )
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
      return why
        ? refuse(why)
        : told(await base.remove(paths, recursive), `deleted ${paths.map((p) => `/home/${p}`).join(", ")}`)
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
        c.op === "write"
          ? [`saved /home/${c.path}`]
          : c.op === "move"
            ? [`moved /home/${c.from} to /home/${c.to}`]
            : c.op === "mkdir"
              ? []
              : [`deleted /home/${c.path}`],
      )
      return said.length ? told(out, said.join(", ")) : out
    },
  }
}

export function withMount(base: FilesBackend, at: string, mounted: FilesBackend): FilesBackend {
  const inside = (p: string) => p === at || p.startsWith(`${at}/`)
  const strip = (p: string) => (p === at ? "" : p.slice(at.length + 1))
  const add = (e: FsEntry): FsEntry => ({ ...e, path: e.path ? `${at}/${e.path}` : at })
  const across: FsFail = {
    ok: false,
    code: "invalid",
    message: `moving between /${at} and the chat's files is not a move. cp it, then rm the original if you mean to`,
  }
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
      const self: FsEntry = {
        kind: "directory",
        path: at,
        files: root?.kind === "directory" ? root.files : 0,
        size: root?.size ?? 0,
      }
      if (!recursive) return [self, ...out]
      const all = await mounted.list("", true)
      return [self, ...(Array.isArray(all) ? all.map(add) : []), ...out]
    },
    bytes: (key, max) =>
      key.startsWith(`${at}:`) || key.includes(`/r/${at}/`) ? mounted.bytes(key, max) : base.bytes(key, max),
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
      if (paths.some((p) => p === at))
        return { ok: false, code: "invalid", message: `/${at} cannot be deleted. delete what is in it instead` }
      const mine = paths.filter(inside)
      if (mine.length && mine.length !== paths.length)
        return { ok: false, code: "invalid", message: `delete /${at} paths and the chat's paths in separate calls` }
      return mine.length ? mounted.remove(mine.map(strip), recursive) : base.remove(paths, recursive)
    },
    async mkdir(path) {
      return inside(path)
        ? path === at
          ? { ok: true, events: [], drop: [], changed: 0 }
          : mounted.mkdir(strip(path))
        : base.mkdir(path)
    },
    async commit(changes) {
      const mine = (c: BatchChange) => batchPaths(c).every(inside)
      const crossing = changes.find((c) => !mine(c) && batchPaths(c).some(inside))
      if (crossing) return { ok: false, path: batchPaths(crossing)[0], message: across.message, conflict: false }
      const ours = changes.filter(mine)
      if (ours.length && ours.length < changes.length)
        return {
          ok: false,
          path: batchPaths(changes[0])[0],
          message: `commit /${at} paths and the chat's paths in separate calls`,
          conflict: false,
        }
      if (changes.some((c) => c.op !== "mkdir" && mine(c) && batchPaths(c).includes(at)))
        return { ok: false, path: at, message: `/${at} stays where it is`, conflict: false }
      if (!ours.length) return base.commit(changes)
      const there = ours.map((c): BatchChange => {
        if (c.op === "move") return { ...c, from: strip(c.from), to: strip(c.to) }
        if (c.op === "rmdir")
          return {
            ...c,
            path: strip(c.path),
            files: Object.fromEntries(Object.entries(c.files).map(([p, sha]) => [strip(p), sha])),
          }
        return { ...c, path: strip(c.path) }
      })
      const out = await mounted.commit(there)
      return out.ok ? out : { ...out, path: `${at}/${out.path}` }
    },
  }
}

export interface SoulPort {
  get(): Promise<{ body: string; sha: string; at: number }>
  forPrompt?(): Promise<{ body: string }>
  set(
    body: string,
    expectSha: string,
  ): Promise<
    | { ok: true; soul: { body: string; sha: string; at: number } }
    | { ok: false; code: "conflict" | "invalid"; message: string }
  >
}

const ME = "me"
const SOUL_PATH = "me/soul.md"

export function withSoul(base: FilesBackend, soul: SoulPort): FilesBackend {
  const enc = new TextEncoder()
  const entry = async (): Promise<FsEntry & { kind: "file" }> => {
    const s = await soul.get()
    return {
      kind: "file",
      path: SOUL_PATH,
      id: "soul",
      size: enc.encode(s.body).length,
      type: "text/markdown",
      sha256: s.sha,
      r2Key: `soul:${s.sha}`,
      at: s.at,
    }
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
      const folder: FsEntry = { kind: "directory", path: ME, files: 1, size: e.size }
      return recursive ? [folder, e, ...out] : [folder, ...out]
    },
    async bytes(r2Key, maxBytes) {
      if (!r2Key.startsWith("soul:")) return base.bytes(r2Key, maxBytes)
      const bytes = enc.encode((await soul.get()).body)
      return maxBytes === undefined ? bytes : bytes.subarray(0, maxBytes)
    },
    async write(path, bytes, type, expectSha256) {
      if (path !== SOUL_PATH)
        return mine(path) ? refuse("only /me/soul.md lives in /me") : base.write(path, bytes, type, expectSha256)
      if (expectSha256 === "none") return { ok: false, code: "conflict", message: `${SOUL_PATH} holds other bytes` }
      const out = await soul.set(new TextDecoder().decode(bytes), expectSha256)
      if (!out.ok)
        return out.code === "conflict" ? { ok: false, code: "conflict", message: out.message } : refuse(out.message)
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
      for (const c of changes) {
        if (c.op === "write" && c.path === SOUL_PATH) continue
        const hit = batchPaths(c).find(mine)
        if (hit !== undefined)
          return {
            ok: false,
            path: hit,
            message: "/me/soul.md stays where it is, and only it lives in /me. edit it instead",
            conflict: false,
          }
      }
      const write = changes.find((c) => c.op === "write" && c.path === SOUL_PATH)
      if (write?.op !== "write") return base.commit(changes)
      if (changes.length > 1)
        return {
          ok: false,
          path: SOUL_PATH,
          message: `${SOUL_PATH} is saved on its own. save it in a call of its own`,
          conflict: false,
        }
      const out = await soul.set(new TextDecoder().decode(write.bytes), write.expect)
      return out.ok
        ? { ok: true }
        : { ok: false, path: SOUL_PATH, message: out.message, conflict: out.code === "conflict" }
    },
  }
}
