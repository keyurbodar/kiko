import type { Context } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Op } from "@earendil-works/chord/delta"
import { type DocumentId, LiveDoc, type Seq, type Storage, type StorageWrite } from "@earendil-works/pi-durable"

type Delta = Extract<StorageWrite, { readonly type: "document.change" }> & {
  readonly content: { readonly kind: "delta"; readonly version: number; readonly ops: readonly Op[] }
}

export type HoldPolicy = (write: Delta, kind: string) => boolean

export type CoalescingOptions = {
  readonly intervalMs?: number
  readonly now?: () => number
  readonly holds?: HoldPolicy
}

export type CoalescingStats = {
  readonly held: number
  readonly written: number
  readonly pending: number
}

export type CoalescingStorage = Storage & {
  flush(): Promise<void>
  stats(): CoalescingStats
}

const GENERATION = "generation"

const opPath = (op: Op): readonly (string | number)[] | undefined => (op[0] === "r" ? undefined : op[1])

// Holding this commit is safe: after a crash the task sends the request again from its checkpoint.
export const holdsPartialOutput: HoldPolicy = (write, kind) =>
  kind === LiveDoc.definition.kind && write.content.ops.length > 0 && write.content.ops.every((op) => opPath(op)?.[0] === GENERATION)

const isDelta = (write: StorageWrite): write is Delta => write.type === "document.change" && write.content.kind === "delta"

const touched = (write: StorageWrite): DocumentId | undefined => {
  switch (write.type) {
    case "document.create":
    case "document.copy":
      return write.record.id
    case "document.change":
    case "document.retire":
      return write.id
    default:
      return undefined
  }
}

type Known = { readonly kind: string; readonly version: number; readonly currentOnly: boolean } | null

type Window = {
  readonly seq: Seq
  readonly openedAt: number
  readonly count: number
  readonly deltas: Map<DocumentId, { readonly version: number; readonly ops: Op[] }>
}

// No timer: a Durable Object must not schedule work with setTimeout (AGENTS.md). The stream always
// ends in a commit that is not held, so the window never outlives it.
export function createCoalescingStorage(inner: Storage, options: CoalescingOptions = {}): CoalescingStorage {
  const intervalMs = options.intervalMs ?? 2000
  const now = options.now ?? Date.now
  const holds = options.holds ?? holdsPartialOutput

  let lastSeq: Seq | undefined
  let window: Window | undefined
  let held = 0
  let written = 0
  const known = new Map<DocumentId, Known>()

  let tail: Promise<unknown> = Promise.resolve()
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation)
    tail = result.catch(() => {})
    return result
  }

  const write = async (writes: readonly StorageWrite[], context: Context) => {
    const seq = await inner.commit(writes, context)
    written++
    lastSeq = seq
    return seq
  }

  const flushNow = async (context: Context) => {
    const open = window
    if (open === undefined) return
    window = undefined
    const writes: StorageWrite[] = [...open.deltas].map(([id, { version, ops }]) => ({
      type: "document.change",
      id,
      content: { kind: "delta", version, ops },
    }))
    const seq = await write(writes, context)
    if (seq !== open.seq) throw new Error(`coalesced flush got seq ${seq}, but its commits reported ${open.seq}`)
  }

  const kindOf = async (id: DocumentId, context: Context): Promise<Known> => {
    const cached = known.get(id)
    if (cached !== undefined) return cached
    const stored = await inner.document(id, "current", context)
    const record = stored?.record
    const currentOnly = record !== undefined && (record.scope.kind !== "conversation" || record.history === "latest")
    const found = stored === undefined ? null : { kind: stored.record.kind, version: stored.version, currentOnly }
    known.set(id, found)
    return found
  }

  const holdable = async (writes: readonly StorageWrite[], context: Context): Promise<Delta | undefined> => {
    if (lastSeq === undefined || writes.length !== 1) return undefined
    const [only] = writes
    if (only === undefined || !isDelta(only)) return undefined
    const stored = await kindOf(only.id, context)
    if (stored === null || !stored.currentOnly || stored.version !== only.content.version) return undefined
    return holds(only, stored.kind) ? only : undefined
  }

  const commit = (writes: readonly StorageWrite[], context: Context) =>
    serial(async () => {
      const delta = await holdable(writes, context)
      if (delta === undefined) {
        await flushNow(context)
        for (const w of writes) {
          const id = touched(w)
          if (id !== undefined) known.delete(id)
        }
        return write(writes, context)
      }
      const open: Window = window ?? { seq: ((lastSeq as number) + 1) as Seq, openedAt: now(), count: 0, deltas: new Map() }
      const entry = open.deltas.get(delta.id) ?? { version: delta.content.version, ops: [] }
      // Storage keeps detached values, so the caller may reuse its batch. A batch that starts with
      // `r` replaces the whole value, and Chord allows `r` only at index 0, so it drops the ops before it.
      const ops = structuredClone(delta.content.ops) as Op[]
      if (ops[0]?.[0] === "r") entry.ops.length = 0
      entry.ops.push(...ops)
      open.deltas.set(delta.id, entry)
      window = { ...open, count: open.count + 1 }
      held++
      if (now() - open.openedAt >= intervalMs) await flushNow(context)
      return open.seq
    })

  const flushed = <T>(context: Context, read: () => Promise<T>) =>
    serial(async () => {
      await flushNow(context)
      return read()
    })

  return {
    commit,
    mintId: () => inner.mintId(),
    conversation: inner.conversation.bind(inner),
    scanConversations: inner.scanConversations.bind(inner),
    entry: inner.entry.bind(inner),
    findLatestHeadMarker: inner.findLatestHeadMarker.bind(inner),
    scanEntries: inner.scanEntries.bind(inner),
    task: inner.task.bind(inner),
    scanTasks: inner.scanTasks.bind(inner),
    submission: inner.submission.bind(inner),
    scanSubmissions: inner.scanSubmissions.bind(inner),
    submissionByRequest: inner.submissionByRequest.bind(inner),
    findDocument: (address, at, context) => flushed(context, () => inner.findDocument(address, at, context)),
    document: (id, at, context) => flushed(context, () => inner.document(id, at, context)),
    scanDocuments: (query, limit, cursor, context) =>
      flushed(context, () => inner.scanDocuments(query, limit, cursor, context)),
    close: (context) =>
      serial(async () => {
        try {
          await flushNow(context)
        } finally {
          await inner.close(context)
        }
      }),
    flush: () => serial(() => flushNow(BACKGROUND_CONTEXT)),
    stats: () => ({ held, written, pending: window?.count ?? 0 }),
  }
}
