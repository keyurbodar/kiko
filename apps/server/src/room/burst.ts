import type { AgentSlug, Envelope, RoomId } from "@kiko/protocol"
import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { JournalStorage } from "@kiko/agent/journal"
import type { RoomLog } from "./log"
import { messageSeqs } from "./message-position"
import type { Members } from "./members"

const MAX_ENTRY_BYTES = 256 * 1024
const MAX_OPEN = 1000

export const BURST_WAKEUP = "burst"

const AFTER_MESSAGE_MS = 1_000
const AFTER_TYPING_MS = 2_500
const AFTER_FRAGMENT_MS = 2_500
const MAX_BURST_MS = 8_000

const DANGLING = new Set(
  "a an the and or but so because cause if then than that which who whom whose when while where though although unless until since as nor yet plus also like with without of to for from in on at by about into onto over under after before between through during against toward towards via per".split(
    " ",
  ),
)

function isFragment(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (/(,|\.\.\.|…)$/.test(t)) return true
  const last = /([a-z']+)$/.exec(t)?.[1]
  return last !== undefined && DANGLING.has(last)
}

function debounce(event: "message" | "typing" | "fragment", now: number, startedAt: number): number {
  const wait = event === "message" ? AFTER_MESSAGE_MS : event === "fragment" ? AFTER_FRAGMENT_MS : AFTER_TYPING_MS
  return Math.min(now + wait, startedAt + MAX_BURST_MS)
}

const MAX_DELIVERY_ENVELOPES = MAX_OPEN / 5
const MAX_DELIVERY_BYTES = MAX_ENTRY_BYTES / 2

export function deliverable<T>(
  envelopes: readonly T[],
  maxCount = MAX_DELIVERY_ENVELOPES,
  maxBytes = MAX_DELIVERY_BYTES,
): T[] {
  let bytes = 0
  const out: T[] = []
  for (const e of envelopes) {
    bytes += new TextEncoder().encode(JSON.stringify(e)).length
    if (out.length && (out.length >= maxCount || bytes > maxBytes)) break
    out.push(e)
  }
  return out
}

export const envelopeId = (messageId: string) => `human:${messageId}`

export type Pending = { envelope: Envelope; mentions: string[] }

export class Burst {
  private readyAt?: number
  private settling = false
  private restored?: Promise<void>
  private readonly durable = new Map<AgentSlug, number>()
  private readonly admitted = new Map<AgentSlug, number>()

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly roomId: string,
    private readonly alarms: Alarms,
    private readonly log: RoomLog,
    private readonly members: Members,
    private readonly now: () => number = Date.now,
  ) {}

  restore(): Promise<void> {
    return (this.restored ??= this.restoreCursors())
  }

  private async restoreCursors(): Promise<void> {
    for (const { slug } of this.members.list()) {
      const journal = JournalStorage.open(this.storage, `${this.roomId}:${slug}`)
      let cursor: Parameters<JournalStorage["scanSubmissions"]>[2]
      let after = 0
      do {
        const page = await journal.scanSubmissions({}, 200, cursor, BACKGROUND_CONTEXT)
        for (const submission of page.items) {
          if (submission.type !== "input" || submission.entry === undefined) continue
          const data = (await journal.entry(submission.entry, BACKGROUND_CONTEXT))?.entry.data
          if (!data || typeof data !== "object" || Array.isArray(data)) continue
          if (typeof data.humanDeliveredSeq === "number") after = Math.max(after, data.humanDeliveredSeq)
          if (!Array.isArray(data.envelopeIds)) continue
          const ids = data.envelopeIds.flatMap((id) =>
            typeof id === "string" && id.startsWith("human:") ? [id.slice(6).split("#")[0]] : [],
          )
          const seq = this.storage.sql
            .exec<{ seq: number | null }>(
              "SELECT max(seq) AS seq FROM messages WHERE room_id = ? AND json_extract(sender, '$.kind') = 'human' AND seq IN (SELECT value FROM json_each(?))",
              this.roomId,
              messageSeqs(this.roomId, ids),
            )
            .one().seq
          after = Math.max(after, seq ?? 0)
        }
        cursor = page.next
      } while (cursor)
      await journal.close(BACKGROUND_CONTEXT)
      this.durable.set(slug, after)
    }
  }

  forAgent(slug: AgentSlug, limit = MAX_DELIVERY_ENVELOPES): Pending[] {
    return this.log
      .unansweredFor(slug, this.durable.get(slug) ?? 0, Number.MAX_SAFE_INTEGER)
      .filter(({ envelope }) => envelope.seq > (this.admitted.get(slug) ?? 0))
      .slice(0, limit)
  }

  accepted(slug: AgentSlug, envelopes: readonly Envelope[]): void {
    for (const envelope of envelopes) this.admitted.set(slug, Math.max(this.admitted.get(slug) ?? 0, envelope.seq))
  }

  pending(): boolean {
    return this.members.list().some(({ slug }) => this.forAgent(slug, 1).length > 0)
  }

  private startedAt(): number | null {
    const first = this.envelopes().at(0)
    return first ? (this.log.message(first.envelope.rootId)?.at ?? null) : null
  }

  async arm(text: string): Promise<void> {
    await this.restore()
    const now = this.now()
    this.readyAt = debounce(isFragment(text) ? "fragment" : "message", now, this.startedAt() ?? now)
    await this.alarms.setWakeup(BURST_WAKEUP, this.readyAt)
  }

  async settle(flush: () => Promise<void>): Promise<void> {
    await this.restore()
    if (this.settling || !this.pending()) return
    this.settling = true
    try {
      while (this.pending()) {
        const at = this.deadline() ?? this.now()
        if (at > this.now()) {
          await scheduler.wait(at - this.now())
          continue
        }
        const before = this.envelopes()
          .map(({ envelope }) => envelope.id)
          .join("\n")
        await flush()
        if (
          this.pending() &&
          before ===
            this.envelopes()
              .map(({ envelope }) => envelope.id)
              .join("\n")
        ) {
          this.readyAt = this.now() + AFTER_MESSAGE_MS
          await this.alarms.setWakeup(BURST_WAKEUP, this.readyAt)
          return
        }
      }
      this.readyAt = undefined
      await this.alarms.clearWakeup(BURST_WAKEUP)
    } finally {
      this.settling = false
    }
  }

  async typing(): Promise<void> {
    await this.restore()
    const startedAt = this.startedAt()
    if (startedAt === null) return
    this.readyAt = debounce("typing", this.now(), startedAt)
    await this.alarms.setWakeup(BURST_WAKEUP, this.readyAt)
  }

  envelopes(_roomId?: RoomId, limit = MAX_DELIVERY_ENVELOPES): Pending[] {
    const unique = new Map<string, Pending>()
    for (const { slug } of this.members.list())
      for (const pending of this.forAgent(slug, limit)) unique.set(pending.envelope.id, pending)
    return [...unique.values()].sort((a, b) => a.envelope.seq - b.envelope.seq).slice(0, limit)
  }

  deadline(): number | undefined {
    const pending = this.envelopes(undefined, Number.MAX_SAFE_INTEGER)
    const first = pending[0]
    const last = pending.at(-1)
    if (!first || !last) return undefined
    const firstAt = this.log.message(first.envelope.rootId)?.at
    const lastAt = this.log.message(last.envelope.rootId)?.at
    if (firstAt === undefined || lastAt === undefined) return undefined
    return this.readyAt ?? debounce(isFragment(last.envelope.body) ? "fragment" : "message", lastAt, firstAt)
  }

  async retry(ms: number): Promise<void> {
    if (this.pending()) await this.alarms.setWakeup(BURST_WAKEUP, this.now() + ms)
  }
}
