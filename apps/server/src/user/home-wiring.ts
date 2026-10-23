import type { FileBucket } from "../files/store"
import type { Actor, FileOp, UserEvent } from "@kiko/protocol"
import type { Env } from "../index"
import type {
  CommitResult,
  FileIndex,
  FsChange,
  FsEntry,
  FsFail,
  IndexChange,
  NewFile,
  PutResult,
} from "../files/file-index"
import { cleanPath, deleteFiles } from "../files/paths"

type HomeDeps = {
  ctx: DurableObjectState
  env: Env
  files: FileBucket
  home: FileIndex<UserEvent>
  holding: { set(held: UserEvent[] | null): void }
  broadcast: (frame: { t: "events"; events: UserEvent[] }) => void
}

export class HomeWiring {
  constructor(private readonly d: HomeDeps) {}

  put(input: NewFile): Omit<PutResult, "events"> & { fresh: boolean; entry: FsEntry | null } {
    const { events, ...result } = this.d.home.put(input)
    return {
      ...result,
      fresh: events.some((e) => e.t === "file"),
      entry: result.file && !result.conflict ? this.d.home.stat(input.path) : null,
    }
  }

  stat(path: string): FsEntry | null {
    return this.d.home.stat(path)
  }

  list(dir: string, recursive: boolean): FsEntry[] | FsFail {
    return this.d.home.list(dir, recursive)
  }

  move(by: Actor, from: string, to: string): FsChange | FsFail {
    return this.dropAfter(this.d.home.move(from, to, by))
  }

  remove(by: Actor, paths: readonly string[], recursive: boolean): FsChange | FsFail {
    return this.dropAfter(this.d.home.remove(paths, recursive, by))
  }

  mkdir(by: Actor, path: string): FsChange | FsFail {
    return this.d.home.mkdir(path, by)
  }

  commit(by: Actor, changes: readonly IndexChange[]): CommitResult {
    const held: UserEvent[] = []
    this.d.holding.set(held)
    let out: CommitResult<UserEvent>
    try {
      out = this.d.home.commit(changes, by)
    } finally {
      this.d.holding.set(null)
    }
    if (!out.ok) return out
    if (held.length) this.d.broadcast({ t: "events", events: held })
    this.dropAfter({ ok: true, events: [], drop: out.drop, changed: changes.length })
    return { ok: true, events: [], drop: [] }
  }

  op(op: FileOp): string | null {
    const human = { kind: "human" } as const
    const paths = op.op === "rm" ? op.paths : op.op === "mv" ? [op.from, op.to] : [op.path]
    if (paths.some((p) => cleanPath(p) === null)) return "that is not a path in your drive"
    const out =
      op.op === "rm"
        ? this.dropAfter(this.d.home.remove(op.paths, op.recursive ?? false, human))
        : op.op === "mv"
          ? this.dropAfter(this.d.home.move(op.from, op.to, human))
          : this.d.home.mkdir(op.path, human)
    return out.ok ? null : out.message
  }

  private dropAfter<T extends FsChange | FsFail>(out: T): T {
    if (out.ok && out.drop.length)
      this.d.ctx.waitUntil(
        deleteFiles(this.d.files, out.drop).catch((e: unknown) =>
          console.error(`r2 delete failed: ${e instanceof Error ? e.message : String(e)}`),
        ),
      )
    return out
  }
}
