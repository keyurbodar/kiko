import type { Actor, FileRef } from "@yuki/protocol"

export type FileRow = {
  id: string
  path: string
  r2_key: string
  size: number
  type: string
  sha256: string
  author: string
  at?: number
}

export type NewFile = {
  id: string
  path: string
  r2Key: string
  size: number
  type: string
  sha256: string
  author: Actor
  expectSha256: string
}

export type FsEntry =
  | { kind: "file"; path: string; id: string; size: number; type: string; sha256: string; r2Key: string; at: number }
  | { kind: "directory"; path: string; files: number; size: number }

export type FsFail = { ok: false; code: "not_found" | "is_directory" | "not_directory" | "invalid"; message: string }
export type FsChange<E = unknown> = { ok: true; events: E[]; drop: string[]; changed: number; folders?: number }

export type FileBody = { t: "file"; file: FileRef } | { t: "file_removed"; ids: readonly string[] } | { t: "folders"; folders: readonly string[] }

export type PutResult<E = unknown> = {
  file: FileRef | null
  drop: string | null
  events: E[]
  conflict?: boolean
  refused?: FsFail
}

export const fail = (code: FsFail["code"], message: string): FsFail => ({ ok: false, code, message })

export type IndexChange =
  | { op: "put"; file: NewFile }
  | { op: "move"; from: string; to: string; sha256: string }
  | { op: "remove"; path: string; sha256: string }
  | { op: "rmdir"; path: string; files: Readonly<Record<string, string>> }
  | { op: "mkdir"; path: string }

export type CommitResult<E = unknown> = { ok: true; events: E[]; drop: string[] } | { ok: false; path: string; message: string; conflict: boolean }

export const changePaths = (c: IndexChange): string[] => (c.op === "put" ? [c.file.path] : c.op === "move" ? [c.from, c.to] : [c.path])

class Refused {
  constructor(
    readonly path: string,
    readonly message: string,
    readonly conflict: boolean,
  ) {}
}

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

export function parents(path: string): string[] {
  const out: string[] = []
  for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) out.push(path.slice(0, i))
  return out
}

function under(dir: string): [string, string | null] {
  return dir ? [`${dir}/`, `${dir}0`] : ["", null]
}

export function toRef(r: FileRow): FileRef {
  return { id: r.id, name: r.path, size: r.size, type: r.type }
}

export type Tables = { files: string; dirs: string }

export const ROOM_TABLES: Tables = { files: "ws_files", dirs: "ws_dirs" }
export const HOME_TABLES: Tables = { files: "home_files", dirs: "home_dirs" }

export function listSpace(storage: DurableObjectStorage, t: Tables): { files: FileRef[]; folders: string[] } {
  const has = (name: string) => storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name).toArray().length > 0
  return {
    files: has(t.files) ? storage.sql.exec<FileRow>(`SELECT * FROM ${t.files} ORDER BY path`).toArray().map(toRef) : [],
    folders: has(t.dirs) ? storage.sql.exec<{ path: string }>(`SELECT path FROM ${t.dirs} ORDER BY path`).toArray().map((r) => r.path) : [],
  }
}

export class FileIndex<E> {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly t: Tables,
    private readonly append: (author: string, body: FileBody) => E,
    private readonly actorKey: (actor: Actor) => string,
  ) {
    const sql = storage.sql
    sql.exec(`CREATE TABLE IF NOT EXISTS ${t.files} (
      id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, r2_key TEXT NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL,
      sha256 TEXT NOT NULL, width INTEGER, height INTEGER, thumbhash TEXT, author TEXT NOT NULL, at INTEGER NOT NULL)`)
    sql.exec(`CREATE TABLE IF NOT EXISTS ${t.dirs} (path TEXT PRIMARY KEY)`)
  }

  private get sql() {
    return this.storage.sql
  }

  private row(column: "id" | "path", value: string): FileRow | null {
    return this.sql.exec<FileRow>(`SELECT * FROM ${this.t.files} WHERE ${column} = ?`, value).toArray()[0] ?? null
  }

  all(): FileRef[] {
    return this.sql.exec<FileRow>(`SELECT * FROM ${this.t.files} ORDER BY path`).toArray().map(toRef)
  }

  folders(): string[] {
    return this.sql.exec<{ path: string }>(`SELECT path FROM ${this.t.dirs} ORDER BY path`).toArray().map((r) => r.path)
  }

  private dirRows(dir: string): string[] {
    const [lo, hi] = under(dir)
    return (
      hi === null
        ? this.sql.exec<{ path: string }>(`SELECT path FROM ${this.t.dirs} WHERE path >= ? ORDER BY path`, lo)
        : this.sql.exec<{ path: string }>(`SELECT path FROM ${this.t.dirs} WHERE path >= ? AND path < ? ORDER BY path`, lo, hi)
    )
      .toArray()
      .map((r) => r.path)
  }

  private files(dir: string, limit = -1): FileRow[] {
    const [lo, hi] = under(dir)
    return hi === null
      ? this.sql.exec<FileRow>(`SELECT * FROM ${this.t.files} WHERE path >= ? ORDER BY path LIMIT ?`, lo, limit).toArray()
      : this.sql.exec<FileRow>(`SELECT * FROM ${this.t.files} WHERE path >= ? AND path < ? ORDER BY path LIMIT ?`, lo, hi, limit).toArray()
  }

  private isDir(path: string): boolean {
    if (path === "") return true
    if (this.sql.exec(`SELECT 1 FROM ${this.t.dirs} WHERE path = ?`, path).toArray().length) return true
    // A file below a path makes it a folder even without a row, as for a file written before rows existed.
    return this.files(path, 1).length > 0
  }

  private insertDirs(paths: readonly string[]): number {
    let added = 0
    for (const p of paths) if (p) added += this.sql.exec(`INSERT OR IGNORE INTO ${this.t.dirs} (path) VALUES (?)`, p).rowsWritten
    return added
  }

  private addDirs(paths: readonly string[], author: string): E[] {
    return this.insertDirs(paths) ? [this.foldersEvent(author)] : []
  }

  private foldersEvent(author: string): E {
    return this.append(author, { t: "folders", folders: this.folders() })
  }

  private clash(path: string, as: "file" | "folder"): FsFail | null {
    if (as === "file" && this.isDir(path)) return fail("is_directory", `${path} is a folder`)
    if (as === "folder" && this.row("path", path)) return fail("not_directory", `${path} is a file`)
    for (const parent of parents(path)) if (this.row("path", parent)) return fail("not_directory", `${parent} is a file, not a folder`)
    return null
  }

  put(input: NewFile): PutResult<E> {
    return this.storage.transactionSync(() => {
      const same = this.row("id", input.id)
      if (same) return { file: toRef(same), drop: null, events: [] }
      const current = this.row("path", input.path)
      if ((current?.sha256 ?? "none") !== input.expectSha256) {
        return { file: current ? toRef(current) : null, drop: input.r2Key, events: [], conflict: true }
      }
      if (!current) {
        const clash = this.clash(input.path, "file")
        if (clash) return { file: null, drop: input.r2Key, events: [], refused: clash }
      }
      if (current?.sha256 === input.sha256) return { file: toRef(current), drop: input.r2Key, events: [] }
      const author = this.actorKey(input.author)
      const row: FileRow = {
        id: input.id,
        path: input.path,
        r2_key: input.r2Key,
        size: input.size,
        type: input.type,
        sha256: input.sha256,
        author,
      }
      const events = this.addDirs(parents(input.path), author)
      const file = toRef(row)
      const at = Date.now()
      events.push(this.append(author, { t: "file", file }))
      if (current) this.sql.exec(`DELETE FROM ${this.t.files} WHERE id = ?`, current.id)
      this.sql.exec(
        `INSERT INTO ${this.t.files} (id, path, r2_key, size, type, sha256, author, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.path,
        row.r2_key,
        row.size,
        row.type,
        row.sha256,
        author,
        at,
      )
      return { file, drop: current?.r2_key ?? null, events }
    })
  }

  private entry(r: FileRow): FsEntry {
    return { kind: "file", path: r.path, id: r.id, size: r.size, type: r.type, sha256: r.sha256, r2Key: r.r2_key, at: r.at ?? 0 }
  }

  stat(path: string): FsEntry | null {
    const file = this.row("path", path)
    if (file) return this.entry(file)
    return this.isDir(path) ? { kind: "directory", path, ...this.tally(path) } : null
  }

  private tally(dir: string): { files: number; size: number } {
    const [lo, hi] = under(dir)
    const row =
      hi === null
        ? this.sql.exec<{ n: number; size: number | null }>(`SELECT count(*) AS n, sum(size) AS size FROM ${this.t.files} WHERE path >= ?`, lo).one()
        : this.sql.exec<{ n: number; size: number | null }>(`SELECT count(*) AS n, sum(size) AS size FROM ${this.t.files} WHERE path >= ? AND path < ?`, lo, hi).one()
    return { files: row.n, size: row.size ?? 0 }
  }

  list(dir: string, recursive = false): FsEntry[] | FsFail {
    const self = this.stat(dir)
    if (!self) return fail("not_found", `no such folder: ${dir}`)
    if (self.kind === "file") return [self]
    const prefix = dir ? `${dir}/` : ""
    const files = this.files(dir)
    const names = new Set<string>()
    for (const p of this.dirRows(dir)) names.add(recursive ? p : prefix + (p.slice(prefix.length).split("/")[0] ?? ""))
    for (const r of files) {
      const rest = r.path.slice(prefix.length)
      if (!rest.includes("/")) continue
      if (recursive) for (const p of parents(rest)) names.add(prefix + p)
      else names.add(prefix + (rest.split("/")[0] ?? ""))
    }
    const dirs: FsEntry[] = [...names].sort().map((path) => ({ kind: "directory", path, ...this.tally(path) }))
    const shown = recursive ? files : files.filter((r) => !r.path.slice(prefix.length).includes("/"))
    return [...dirs, ...shown.map((r) => this.entry(r))]
  }

  mkdir(path: string, by: Actor): FsChange<E> | FsFail {
    return this.storage.transactionSync(() => {
      if (path === "") return { ok: true, events: [], drop: [], changed: 0 }
      const clash = this.clash(path, "folder")
      if (clash) return clash
      const events = this.addDirs([...parents(path), path], this.actorKey(by))
      return { ok: true, events, drop: [], changed: events.length ? 1 : 0 }
    })
  }

  move(from: string, to: string, by: Actor): FsChange<E> | FsFail {
    return this.storage.transactionSync(() => {
      const src = this.stat(from)
      if (!src || from === "") return fail("not_found", `no such file or folder: ${from || "/"}`)
      const dest = this.stat(to)
      const target = dest?.kind === "directory" ? (to ? `${to}/${baseName(from)}` : baseName(from)) : to
      if (target === from) return { ok: true, events: [], drop: [], changed: 0 }
      if (target === "" || `${target}/`.startsWith(`${from}/`)) return fail("invalid", `cannot move ${from} into itself`)
      const author = this.actorKey(by)
      const events: E[] = []
      const drop: string[] = []
      const there = this.stat(target)
      if (src.kind === "file") {
        if (there?.kind === "directory") return fail("is_directory", `${target} is a folder`)
        if (!there) {
          const clash = this.clash(target, "file")
          if (clash) return clash
        }
        if (there?.kind === "file") {
          this.sql.exec(`DELETE FROM ${this.t.files} WHERE id = ?`, there.id)
          drop.push(there.r2Key)
          events.push(this.append(author, { t: "file_removed", ids: [there.id] }))
        }
        events.push(...this.addDirs(parents(target), author))
        const srcRow = this.row("id", src.id)
        if (!srcRow) throw new Error(`no file row for ${src.id}`)
        events.push(this.rename(srcRow, target, author))
        return { ok: true, events, drop, changed: 1 }
      }
      if (there) return fail(there.kind === "file" ? "not_directory" : "is_directory", `${target} already exists`)
      const clash = this.clash(target, "folder")
      if (clash) return clash
      const rows = this.files(from)
      for (const r of rows) events.push(this.rename(r, target + r.path.slice(from.length), author))
      const moved = [from, ...this.dirRows(from)]
      for (const p of moved) this.sql.exec(`DELETE FROM ${this.t.dirs} WHERE path = ?`, p)
      this.insertDirs([...parents(target), ...moved.map((p) => target + p.slice(from.length))])
      events.push(this.foldersEvent(author))
      return { ok: true, events, drop, changed: rows.length || 1 }
    })
  }

  private rename(r: FileRow, path: string, author: string): E {
    this.sql.exec(`UPDATE ${this.t.files} SET path = ? WHERE id = ?`, path, r.id)
    return this.append(author, { t: "file", file: toRef({ ...r, path }) })
  }

  remove(paths: readonly string[], recursive: boolean, by: Actor): FsChange<E> | FsFail {
    return this.storage.transactionSync(() => {
      const rows = new Map<string, FileRow>()
      const dirs = new Set<string>()
      for (const path of paths) {
        const entry = this.stat(path)
        if (!entry || path === "") return fail("not_found", `no such file or folder: ${path || "/"}`)
        if (entry.kind === "file") {
          const row = this.row("id", entry.id)
          if (!row) throw new Error(`no file row for ${entry.id}`)
          rows.set(entry.id, row)
          continue
        }
        const inside = this.files(path)
        const subdirs = this.dirRows(path)
        if (!recursive && (inside.length || subdirs.length)) return fail("is_directory", `${path} is a folder with things in it. remove it with recursive`)
        for (const r of inside) rows.set(r.id, r)
        for (const d of [path, ...subdirs]) dirs.add(d)
      }
      const author = this.actorKey(by)
      const events: E[] = []
      for (const id of rows.keys()) this.sql.exec(`DELETE FROM ${this.t.files} WHERE id = ?`, id)
      if (rows.size) events.push(this.append(author, { t: "file_removed", ids: [...rows.keys()] }))
      for (const d of dirs) this.sql.exec(`DELETE FROM ${this.t.dirs} WHERE path = ?`, d)
      if (dirs.size) events.push(this.foldersEvent(author))
      return { ok: true, events, drop: [...rows.values()].map((r) => r.r2_key), changed: rows.size, folders: dirs.size }
    })
  }

  commit(changes: readonly IndexChange[], by: Actor): CommitResult<E> {
    const changed = (path: string) => new Refused(path, "changed", true)
    try {
      return this.storage.transactionSync(() => {
        const events: E[] = []
        const drop: string[] = []
        const take = (out: FsChange<E> | FsFail, path: string) => {
          if (!out.ok) throw new Refused(path, out.message, false)
          events.push(...out.events)
          drop.push(...out.drop)
        }
        for (const c of changes) {
          switch (c.op) {
            case "put": {
              const out = this.put(c.file)
              if (out.conflict) throw changed(c.file.path)
              if (out.refused) throw new Refused(c.file.path, out.refused.message, false)
              events.push(...out.events)
              if (out.drop) drop.push(out.drop)
              break
            }
            case "move": {
              const src = this.stat(c.from)
              if (src?.kind !== "file" || src.sha256 !== c.sha256) throw changed(c.from)
              if (this.stat(c.to)) throw changed(c.to)
              take(this.move(c.from, c.to, by), c.to)
              break
            }
            case "remove": {
              const now = this.stat(c.path)
              if (now?.kind !== "file" || now.sha256 !== c.sha256) throw changed(c.path)
              take(this.remove([c.path], false, by), c.path)
              break
            }
            case "rmdir": {
              const now = this.list(c.path, true)
              if (!Array.isArray(now)) throw changed(c.path)
              const files = now.filter((e) => e.kind === "file")
              if (files.length !== Object.keys(c.files).length || files.some((e) => c.files[e.path] !== e.sha256)) throw changed(c.path)
              take(this.remove([c.path], true, by), c.path)
              break
            }
            case "mkdir":
              take(this.mkdir(c.path, by), c.path)
              break
          }
        }
        return { ok: true as const, events, drop }
      })
    } catch (e) {
      if (e instanceof Refused) return { ok: false, path: e.path, message: e.message, conflict: e.conflict }
      throw e
    }
  }
}
