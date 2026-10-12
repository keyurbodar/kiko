import { toHex } from "@yuki/durable/hash"
import type { Context } from "@earendil-works/chord"
import { err, ExecutionError, ok, type Result, type ShellExecOptions, type ShellExecResult } from "@earendil-works/pi-durable/env"
import { Bash, type BufferEncoding, type CpOptions, type CreateExclusiveOptions, type FileContent, type FsStat, type IFileSystem, type MkdirOptions, type RmOptions } from "just-bash"
import type { FsEntry } from "../room/files"
import { type BatchChange, batchPaths, HOME_PATH, type RoomFs, typeForPath } from "./room-fs"

export const DEFAULT_TIMEOUT_S = 30
export const MAX_TIMEOUT_S = 120
const PREFETCH_FILES = 32
const PREFETCH_MAX_FILE = 256 * 1024
const PREFETCH_BYTES = 8 * 1024 * 1024
// UNVERIFIED: AGENTS.md and architecture.md say Free allows 50 subrequests per invocation, which this
// budget does not fit. Whether R2 reads inside a Durable Object count against that limit is still open.
// Measure it before changing this number.
const MAX_READS = 400
const DIRTY_BYTES = 16 * 1024 * 1024

type Base = FsEntry & { kind: "file" }
type FileNode = { kind: "file"; base?: Base; bytes?: Uint8Array; at: number }
type Node = FileNode | { kind: "directory" }

const SCRATCH = ["/tmp", "/dev"]
const DEV_NULL = "/dev/null"

const failure = (code: string, message: string) => Object.assign(new Error(`${code}: ${message}`), { code })

export function resolve(base: string, path: string): string {
  const parts: string[] = []
  for (const part of (path.startsWith("/") ? path : `${base}/${path}`).split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return `/${parts.join("/")}`
}

const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/"
const under = (dir: string, path: string) => (dir === "/" ? path !== "/" : path.startsWith(`${dir}/`))
const scratch = (path: string) => SCRATCH.some((s) => path === s || under(s, path))
const sizeOf = (n: FileNode) => n.bytes?.length ?? n.base?.size ?? 0

function decode(bytes: Uint8Array, encoding: BufferEncoding | null | undefined): string {
  switch (encoding) {
    case "binary":
    case "latin1": {
      let out = ""
      for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return out
    }
    case "base64":
      return btoa(decode(bytes, "latin1"))
    case "hex":
      return toHex(bytes)
    default:
      return new TextDecoder().decode(bytes)
  }
}

function encode(content: FileContent, encoding: BufferEncoding | undefined): Uint8Array {
  if (typeof content !== "string") return content
  switch (encoding) {
    case "binary":
    case "latin1":
      return Uint8Array.from(content, (c) => c.charCodeAt(0) & 0xff)
    case "base64":
      return encode(atob(content), "latin1")
    case "hex":
      return Uint8Array.from(content.match(/../g) ?? [], (h) => Number.parseInt(h, 16))
    default:
      return new TextEncoder().encode(content)
  }
}

const encodingOf = (options: { encoding?: BufferEncoding | null } | BufferEncoding | undefined) => (typeof options === "string" ? options : (options?.encoding ?? undefined))

type Change =
  | { op: "write"; path: string; node: FileNode; expect: string }
  | { op: "move"; from: string; to: string; sha256: string }
  | { op: "remove"; path: string; sha256: string }
  | { op: "rmdir"; path: string; files: Readonly<Record<string, string>> }
  | { op: "mkdir"; path: string }

const SPACES = ["chat", "home", "me"] as const
type Space = (typeof SPACES)[number]
const SPACE_NAME: Record<Space, string> = { home: "the drive (/home)", me: "/me", chat: "the chat's files" }
const spaceOf = (path: string): Space => (path === `/${HOME_PATH}` || path.startsWith(`/${HOME_PATH}/`) ? "home" : path.startsWith("/me/") || path === "/me" ? "me" : "chat")

function plan(start: ReadonlyMap<string, Node>, tree: ReadonlyMap<string, Node>): Change[] {
  const moves: Change[] = []
  const writes: Change[] = []
  const deletions: Change[] = []
  const movedFrom = new Set<string>()
  const startFile = (p: string) => {
    const n = start.get(p)
    return n?.kind === "file" ? n.base : undefined
  }
  for (const [path, node] of tree) {
    if (node.kind !== "file" || scratch(path)) continue
    const before = startFile(path)
    const base = node.base
    const origin = base && !node.bytes ? `/${base.path}` : null
    if (origin === path && before?.sha256 === base?.sha256) continue
    const stays = origin ? tree.get(origin) : undefined
    const originGone = origin !== null && origin !== path && !(stays?.kind === "file" && stays.base === base && !stays.bytes)
    if (base && origin !== null && originGone && !before && !movedFrom.has(origin) && spaceOf(origin) === spaceOf(path) && startFile(origin)?.sha256 === base.sha256) {
      movedFrom.add(origin)
      moves.push({ op: "move", from: origin, to: path, sha256: base.sha256 })
    } else {
      writes.push({ op: "write", path, node, expect: "" })
    }
  }
  for (const c of writes) if (c.op === "write") c.expect = movedFrom.has(c.path) ? "none" : (startFile(c.path)?.sha256 ?? "none")
  for (const [path, node] of tree) {
    if (node.kind !== "directory" || scratch(path) || start.has(path)) continue
    if (![...tree.keys()].some((p) => under(path, p))) writes.push({ op: "mkdir", path })
  }
  const goneDirs = [...start].filter(([p, n]) => n.kind === "directory" && p !== "/" && !scratch(p) && !tree.has(p)).map(([p]) => p)
  const topDirs = goneDirs.filter((d) => !goneDirs.some((o) => o !== d && under(o, d)))
  for (const dir of topDirs) {
    const files: Record<string, string> = {}
    for (const [p, n] of start) if (under(dir, p) && n.kind === "file" && n.base && !movedFrom.has(p)) files[p] = n.base.sha256
    deletions.push({ op: "rmdir", path: dir, files })
  }
  for (const [path, node] of start) {
    if (node.kind !== "file" || !node.base || scratch(path) || tree.has(path) || movedFrom.has(path) || topDirs.some((d) => under(d, path))) continue
    deletions.push({ op: "remove", path, sha256: node.base.sha256 })
  }
  return [...moves, ...writes, ...deletions]
}

type Refusal = { path: string; message: string }

class CommandFs implements IFileSystem {
  private readonly tree = new Map<string, Node>()
  private start: ReadonlyMap<string, Node> = new Map()
  private readonly listed = new Set<string>()
  private readonly ahead = new Map<string, Promise<Uint8Array | null>>()
  private aheadBytes = 0
  private dirty = 0
  readonly overRead = new AbortController()

  private constructor(private readonly files: RoomFs) {}

  static async open(files: RoomFs): Promise<CommandFs> {
    const fs = new CommandFs(files)
    const all = await files.list("/", true)
    if (!all.ok) throw all.error
    fs.tree.set("/", { kind: "directory" })
    for (const e of all.value) {
      const path = `/${e.path}`
      if (!scratch(path)) fs.put(path, e.kind === "file" ? { kind: "file", base: e, at: e.at } : { kind: "directory" })
    }
    fs.start = new Map(fs.tree)
    fs.put("/tmp", { kind: "directory" })
    fs.put(DEV_NULL, { kind: "file", bytes: new Uint8Array(), at: 0 })
    return fs
  }

  private put(path: string, node: Node) {
    for (let dir = parent(path); !this.tree.has(dir); dir = parent(dir)) this.tree.set(dir, { kind: "directory" })
    this.tree.set(path, node)
  }

  private subtree(path: string): [string, Node][] {
    return [...this.tree].filter(([p]) => p === path || under(path, p))
  }

  private node(path: string, op: string): Node {
    const found = this.tree.get(path)
    if (!found) throw failure("ENOENT", `no such file or directory, ${op} '${path}'`)
    return found
  }

  private file(path: string, op: string): FileNode {
    const found = this.node(path, op)
    if (found.kind === "directory") throw failure("EISDIR", `illegal operation on a directory, ${op} '${path}'`)
    return found
  }

  private children(dir: string): string[] {
    const prefix = dir === "/" ? "/" : `${dir}/`
    const names = new Set<string>()
    for (const p of this.tree.keys()) if (p !== dir && p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) names.add(p.slice(prefix.length))
    return [...names].sort()
  }

  private fetch(base: Base): Promise<Uint8Array | null> {
    const pending = this.ahead.get(base.r2Key)
    if (pending) return pending
    if (this.ahead.size >= MAX_READS) {
      this.overRead.abort()
      throw failure("EMFILE", `one command reads at most ${MAX_READS} files`)
    }
    const out = this.files.bytesOf(base)
    this.ahead.set(base.r2Key, out)
    return out
  }

  private readAhead(dir: string) {
    if (!this.listed.delete(dir)) return
    let started = 0
    for (const name of this.children(dir)) {
      if (started >= PREFETCH_FILES) break
      const n = this.tree.get(dir === "/" ? `/${name}` : `${dir}/${name}`)
      if (n?.kind !== "file" || !n.base || n.bytes || n.base.size > PREFETCH_MAX_FILE || this.ahead.has(n.base.r2Key)) continue
      if (this.aheadBytes + n.base.size > PREFETCH_BYTES || this.ahead.size >= MAX_READS / 2) break
      this.aheadBytes += n.base.size
      started++
      void this.fetch(n.base).catch(() => null)
    }
  }

  private async content(path: string, node: FileNode): Promise<Uint8Array> {
    if (node.bytes) return node.bytes
    const bytes = node.base ? await this.fetch(node.base) : null
    if (!bytes) throw failure("ENOENT", `no such file or directory, open '${path}'`)
    return bytes
  }

  private async bytes(path: string): Promise<Uint8Array> {
    const node = this.file(path, "open")
    this.readAhead(parent(path))
    return this.content(path, node)
  }

  private reserve(grows: number) {
    if (this.dirty + grows > DIRTY_BYTES) throw failure("ENOSPC", `no space left: one command holds at most ${DIRTY_BYTES / 1024 / 1024} mb of changed files`)
    this.dirty += grows
  }

  private set(path: string, bytes: Uint8Array) {
    if (path === DEV_NULL) return
    const before = this.tree.get(path)
    if (before?.kind === "directory") throw failure("EISDIR", `illegal operation on a directory, open '${path}'`)
    if (this.tree.get(parent(path))?.kind !== "directory") throw failure("ENOENT", `no such file or directory, open '${path}'`)
    const grows = bytes.length - (before?.kind === "file" ? (before.bytes?.length ?? 0) : 0)
    this.reserve(grows)
    this.tree.set(path, { kind: "file", bytes, at: Date.now() })
  }

  async readFile(path: string, options?: { encoding?: BufferEncoding | null } | BufferEncoding): Promise<string> {
    return decode(await this.bytes(path), encodingOf(options))
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return this.bytes(path)
  }

  async writeFile(path: string, content: FileContent, options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<void> {
    this.set(path, encode(content, encodingOf(options) ?? undefined))
  }

  async appendFile(path: string, content: FileContent, options?: { encoding?: BufferEncoding } | BufferEncoding): Promise<void> {
    const add = encode(content, encodingOf(options) ?? undefined)
    const head = this.tree.get(path)?.kind === "file" ? await this.bytes(path) : new Uint8Array()
    const joined = new Uint8Array(head.length + add.length)
    joined.set(head)
    joined.set(add, head.length)
    this.set(path, joined)
  }

  async exists(path: string): Promise<boolean> {
    return this.tree.has(path)
  }

  async stat(path: string): Promise<FsStat> {
    const n = this.node(path, "stat")
    if (n.kind === "directory") return { isFile: false, isDirectory: true, isSymbolicLink: false, mode: 0o40755, size: 0, mtime: new Date(0), identity: path }
    return { isFile: true, isDirectory: false, isSymbolicLink: false, mode: 0o100644, size: sizeOf(n), mtime: new Date(n.at), identity: path }
  }

  async lstat(path: string): Promise<FsStat> {
    return this.stat(path)
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const n = this.tree.get(path)
    if (n) {
      if (options?.recursive && n.kind === "directory") return
      throw failure("EEXIST", `file already exists, mkdir '${path}'`)
    }
    if (!options?.recursive && this.tree.get(parent(path))?.kind !== "directory") throw failure("ENOENT", `no such file or directory, mkdir '${path}'`)
    this.put(path, { kind: "directory" })
  }

  async createExclusive(path: string, options: CreateExclusiveOptions): Promise<void> {
    if (this.tree.has(path)) throw failure("EEXIST", `file already exists, open '${path}'`)
    if (options.directory) return this.mkdir(path)
    this.set(path, new Uint8Array())
  }

  async readdir(path: string): Promise<string[]> {
    if (this.node(path, "scandir").kind !== "directory") throw failure("ENOTDIR", `not a directory, scandir '${path}'`)
    this.listed.add(path)
    return this.children(path)
  }

  async readdirWithFileTypes(path: string) {
    return (await this.readdir(path)).map((name) => {
      const kind = this.tree.get(path === "/" ? `/${name}` : `${path}/${name}`)?.kind
      return { name, isFile: kind === "file", isDirectory: kind === "directory", isSymbolicLink: false }
    })
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const n = this.tree.get(path)
    if (!n) {
      if (options?.force) return
      throw failure("ENOENT", `no such file or directory, rm '${path}'`)
    }
    if (path === "/") throw failure("EPERM", "the root of the chat's files stays")
    if (n.kind === "directory" && !options?.recursive && this.children(path).length) throw failure("ENOTEMPTY", `directory not empty, rm '${path}'`)
    for (const [p] of this.subtree(path)) this.tree.delete(p)
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const n = this.node(src, "cp")
    if (n.kind === "file") {
      if (this.tree.get(dest)?.kind === "directory") throw failure("EISDIR", `illegal operation on a directory, cp '${dest}'`)
      if (this.tree.get(parent(dest))?.kind !== "directory") throw failure("ENOENT", `no such file or directory, cp '${dest}'`)
      this.reserve(sizeOf(n))
      this.tree.set(dest, n.bytes ? { ...n, bytes: n.bytes.slice() } : { ...n, at: Date.now() })
      return
    }
    if (!options?.recursive) throw failure("EISDIR", `illegal operation on a directory, cp '${src}'`)
    if (under(src, dest)) throw failure("EINVAL", `cannot copy '${src}' into itself`)
    const paths = this.subtree(src)
    this.reserve(paths.reduce((sum, [, m]) => (m.kind === "file" ? sum + sizeOf(m) : sum), 0))
    for (const [p] of paths) this.put(`${dest}${p.slice(src.length)}`, { ...this.node(p, "cp") })
  }

  async mv(src: string, dest: string): Promise<void> {
    this.node(src, "rename")
    if (src === "/") throw failure("EPERM", "the root of the chat's files stays")
    if (under(src, dest)) throw failure("EINVAL", `cannot move '${src}' into itself`)
    if (this.tree.get(parent(dest))?.kind !== "directory") throw failure("ENOENT", `no such file or directory, rename '${dest}'`)
    const moving = this.subtree(src)
    for (const [p] of this.subtree(dest)) this.tree.delete(p)
    for (const [p] of moving) this.tree.delete(p)
    for (const [p, node] of moving) this.tree.set(`${dest}${p.slice(src.length)}`, node)
  }

  resolvePath(base: string, path: string): string {
    return resolve(base, path)
  }

  getAllPaths(): string[] {
    return [...this.tree.keys()]
  }

  async chmod(path: string): Promise<void> {
    this.node(path, "chmod")
  }

  async utimes(path: string): Promise<void> {
    this.node(path, "utimes")
  }

  async symlink(_target: string, link: string): Promise<void> {
    throw failure("EPERM", `the chat's files have no links, symlink '${link}'`)
  }

  async link(_existing: string, link: string): Promise<void> {
    throw failure("EPERM", `the chat's files have no links, link '${link}'`)
  }

  async readlink(path: string): Promise<string> {
    throw failure("EINVAL", `invalid argument, readlink '${path}'`)
  }

  async realpath(path: string): Promise<string> {
    this.node(path, "realpath")
    return path
  }

  // Writes commit before deletions, and a deletion commits only when every write saved, so a refused write
  // keeps the file it would have moved. Each space commits its group in one call. `changed` lists what saved.
  async commit(): Promise<{ saved: string[]; changed: string[]; refused: Refusal[] }> {
    const changes = plan(this.start, this.tree)
    const batch = await Promise.all(
      changes.map(async (c): Promise<BatchChange> => {
        if (c.op !== "write") return c
        const type = !c.node.bytes && c.node.base ? c.node.base.type : typeForPath(c.path)
        return { op: "write", path: c.path, bytes: await this.content(c.path, c.node), type, expect: c.expect }
      }),
    )
    const saved: string[] = []
    const changed: string[] = []
    const refused: Refusal[] = []
    const commitSpaces = async (group: BatchChange[], refuse: (space: string) => string) => {
      for (const space of SPACES) {
        const part = group.filter((c) => spaceOf(c.op === "move" ? c.to : c.path) === space)
        if (!part.length) continue
        const out = await this.files.commit(part)
        if (out.ok) {
          saved.push(SPACE_NAME[space])
          changed.push(...part.flatMap(batchPaths))
          continue
        }
        const why = out.conflict ? `${out.path} changed after this command started (a teammate or the human wrote it)` : out.message
        refused.push({ path: out.path, message: `${why}. ${refuse(SPACE_NAME[space])}` })
      }
    }
    const deletions = batch.filter((c) => c.op === "remove" || c.op === "rmdir")
    await commitSpaces(
      batch.filter((c) => c.op !== "remove" && c.op !== "rmdir"),
      (space) => `nothing this command changed in ${space} was saved. look again, then run it again`,
    )
    if (refused.length) {
      for (const c of deletions) refused.push({ path: batchPaths(c)[0], message: "a write in this command was refused, so this file was kept. look again, then run it again" })
      return { saved, changed, refused }
    }
    await commitSpaces(deletions, () => "the file was kept. look again, then run it again")
    return { saved, changed, refused }
  }
}

const LIMIT_EXIT = 126

// The paths a command saved. The bash tool reports them as its details, so the work hook can list them.
export type BashResult = ShellExecResult & { changed: string[] }

const stopped = (timer: AbortSignal, seconds: number) =>
  timer.aborted ? new ExecutionError("timeout", `the command ran past ${seconds} seconds, and none of its changes were saved`) : new ExecutionError("aborted", "the command was stopped, and none of its changes were saved")

const OVER_READ = `bash: the command read more than ${MAX_READS} files and was stopped, and none of its changes were saved. narrow it to a folder or a pattern, or split it\n`

export async function runCommand(files: RoomFs, command: string, options: ShellExecOptions | undefined, context: Context): Promise<Result<BashResult, ExecutionError>> {
  const seconds = Math.min(options?.timeout ?? DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S)
  const timer = AbortSignal.timeout(seconds * 1000)
  const outside = context.abortSignal ? AbortSignal.any([context.abortSignal, timer]) : timer
  const say = (text: string) => void (text && options?.onOutput?.(text, context))
  let fs: CommandFs | undefined
  // Once the commit starts it runs to its end: a stop after this point cannot undo a save, so the result names what saved.
  let committing = false
  try {
    fs = await CommandFs.open(files)
    const cwd = options?.cwd && (await fs.stat(options.cwd).catch(() => null))?.isDirectory ? options.cwd : "/"
    const bash = new Bash({ fs, cwd, env: { HOME: "/", USER: "agent", TMPDIR: "/tmp", ...options?.env } })
    const out = await bash.exec(command, { cwd, signal: AbortSignal.any([outside, fs.overRead.signal]) })
    if (outside.aborted) return err(stopped(timer, seconds))
    if (fs.overRead.signal.aborted) {
      say(OVER_READ)
      return ok({ exitCode: LIMIT_EXIT, changed: [] })
    }
    if (out.exitCode === LIMIT_EXIT) {
      say(`${out.stdout}${out.stderr}bash: the command hit a limit and was stopped, and none of its changes were saved\n`)
      return ok({ exitCode: LIMIT_EXIT, changed: [] })
    }
    committing = true
    const { saved, changed, refused } = await fs.commit()
    const report = refused.map((r) => `bash: ${r.path}: not saved: ${r.message}\n`)
    if (saved.length && refused.length) report.push(`bash: saved in ${saved.join(" and ")}\n`)
    if (outside.aborted && changed.length) report.push(`bash: stopped while it saved, and these were saved: ${changed.join(", ")}\n`)
    say(out.stdout + out.stderr + report.join(""))
    return ok({ exitCode: refused.length && !out.exitCode ? 1 : out.exitCode, changed })
  } catch (e) {
    if (outside.aborted && !committing) return err(stopped(timer, seconds))
    if (fs?.overRead.signal.aborted) {
      say(OVER_READ)
      return ok({ exitCode: LIMIT_EXIT, changed: [] })
    }
    return err(new ExecutionError("unknown", e instanceof Error ? e.message : String(e)))
  }
}
