import type { Context } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Op } from "@earendil-works/chord/delta"
import { type DocumentId, LiveDoc, type Seq, type Storage, type StorageWrite } from "@earendil-works/pi-durable"

/** One held write: a delta to one document. */
type Delta = Extract<StorageWrite, { readonly type: "document.change" }> & {
  readonly content: { readonly kind: "delta"; readonly version: number; readonly ops: readonly Op[] }
}

/** Decides whether a single-delta commit may be held. `kind` is the stored kind of the changed document. */
export type HoldPolicy = (write: Delta, kind: string) => boolean

export type CoalescingOptions = {
  /** How long the first held commit may wait before a later partial flushes it. Default 2000. */
  readonly intervalMs?: number
  /** Default `Date.now`. Tests pass a fake clock. */
  readonly now?: () => number
  /** Default `holdsPartialOutput`. */
  readonly holds?: HoldPolicy
}

export type CoalescingStats = {
  /** Commits answered from memory. */
  readonly held: number
  /** Commits that reached the inner storage, flushes included. */
  readonly written: number
  /** Held commits not yet written. */
  readonly pending: number
}

export type CoalescingStorage = Storage & {
  /** Write every held commit now. */
  flush(): Promise<void>
  stats(): CoalescingStats
}

const GENERATION = "generation"

/** The path an op changes. `r` replaces the whole value, so it has none. */
const opPath = (op: Op): readonly (string | number)[] | undefined => (op[0] === "r" ? undefined : op[1])

/**
 * The partial-output commit of `pi-durable` 1.0.0 (`streamResponse` in `src/harness/generation.ts`).
 * It is one commit holding one delta to the conversation's `pi.live` document, and every op in it
 * changes `generation`. One other commit has that shape: the request phase sets `generation` to
 * `{ attempt }` before it sends a request. Holding it is safe, because after a crash the task sends
 * the request again from its checkpoint. The other commits that change `generation` also write a
 * task checkpoint, so they have more than one write and are never held.
 */
export const holdsPartialOutput: HoldPolicy = (write, kind) =>
  kind === LiveDoc.definition.kind && write.content.ops.length > 0 && write.content.ops.every((op) => opPath(op)?.[0] === GENERATION)

const isDelta = (write: StorageWrite): write is Delta => write.type === "document.change" && write.content.kind === "delta"

/** Document ids a write names. A cached kind and version is dropped when a write that is not held touches it. */
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
  /** The seq the flush will get. Every held commit in the window returns it. */
  readonly seq: Seq
  readonly openedAt: number
  readonly count: number
  /** Ops per document, in commit order. Concatenated ops apply exactly as the separate batches did. */
  readonly deltas: Map<DocumentId, { readonly version: number; readonly ops: Op[] }>
}

/**
 * A `Storage` over another `Storage` that holds partial-output commits in memory and writes them as
 * one commit. A window opens with the first held commit. A partial that arrives 2 seconds or more
 * after it opened is merged and the window is written at once. Any other commit, any document read,
 * `flush()`, and `close()` write the window first.
 *
 * There is no timer. A Durable Object must not schedule work with `setTimeout` (AGENTS.md), and the
 * stream that produces partials always ends in a commit that is not held, so the window never
 * outlives the stream. A crash loses at most the partials of one window, which `pi-durable` already
 * tolerates: recovery converts whatever partial is stored and sends the request again.
 *
 * A held commit returns the seq its flush will get: the inner storage's last seq plus one. That holds
 * because nothing reaches the inner storage before the flush. Several held commits in one window
 * therefore share one seq. DEVIATION: the `Storage` contract calls a seq strictly increasing per
 * commit. Nothing in `pi-durable` 1.0.0 reads it, but a commit listener must not assume each
 * publication has a seq of its own. The first commit after the storage opens is never held, because
 * the last seq is not known yet.
 */
export function createCoalescingStorage(inner: Storage, options: CoalescingOptions = {}): CoalescingStorage {
  const intervalMs = options.intervalMs ?? 2000
  const now = options.now ?? Date.now
  const holds = options.holds ?? holdsPartialOutput

  let lastSeq: Seq | undefined
  let window: Window | undefined
  let held = 0
  let written = 0
  // Stored kind and version per document, read once. `null` means the inner storage has no current incarnation.
  const known = new Map<DocumentId, Known>()

  // Every call that may reach `inner.commit` runs on this chain, so a flush and a commit never interleave.
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
    // The held commits already reported `open.seq`. A different seq means something else wrote to the database.
    if (seq !== open.seq) throw new Error(`coalesced flush got seq ${seq}, but its commits reported ${open.seq}`)
  }

  const kindOf = async (id: DocumentId, context: Context): Promise<Known> => {
    const cached = known.get(id)
    if (cached !== undefined) return cached
    const stored = await inner.document(id, "current", context)
    const record = stored?.record
    // The inner storage keeps no history for these, so no read can ask for a point inside a window.
    const currentOnly = record !== undefined && (record.scope.kind !== "conversation" || record.history === "latest")
    const found = stored === undefined ? null : { kind: stored.record.kind, version: stored.version, currentOnly }
    known.set(id, found)
    return found
  }

  // Hold only a delta the inner storage would accept (its document exists and the version matches) to a
  // document without history. Merging commits removes the points between them, which only history reads see.
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

  // Only documents can carry a held change, so only document reads flush first.
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
