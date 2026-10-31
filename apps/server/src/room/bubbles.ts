import type { AgentSlug, MessageId, RoomEvent, RunRef } from "@kiko/protocol"
import { RECENT_MESSAGES } from "./message-position"
import type { RoomLog } from "./log"
import { type ImageFile, parseRichText } from "@kiko/protocol/markdown"

const REPLY_TAG = /^\[reply:([^\]\s]+)\]\s*/
const MAX_CACHED_RUNS = 256

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key)
  map.set(key, value)
  if (map.size <= MAX_CACHED_RUNS) return
  const oldest = map.keys().next()
  if (!oldest.done) map.delete(oldest.value)
}

function replyTag(block: string): { text: string; replyTo?: string } {
  const m = REPLY_TAG.exec(block)
  const replyTo = m?.[1]
  return m && replyTo !== undefined ? { text: block.slice(m[0].length).trim(), replyTo } : { text: block }
}

export class Bubbles {
  private readonly sql: SqlStorage
  private readonly latestAttempts = new Map<string, number | null>()
  private readonly endedRuns = new Map<string, boolean>()

  constructor(
    storage: DurableObjectStorage,
    private readonly log: RoomLog,
    private readonly imageFile: ImageFile,
  ) {
    this.sql = storage.sql
  }

  post(slug: AgentSlug, run: RunRef, block: string, initiative?: { reason: string }): RoomEvent[] {
    const latest = this.latestAttempt(run.runId)
    if (latest !== null && run.attempt < latest) return []
    const from = { kind: "agent", slug } as const
    const events: RoomEvent[] = []
    const { text, replyTo } = replyTag(block)
    const target = replyTo && this.log.message(replyTo) ? { replyTo: replyTo as MessageId } : {}
    if (text && run.attempt > 0 && this.log.adoptBubble(run, text, target.replyTo ?? null)) {
      this.rememberRun(run)
      return events
    }
    const earlier = run.attempt > 0 ? this.log.earlierAttempts(run.runId, run.attempt, run.index) : []
    const deleted = earlier.length ? this.log.deleteMessages(earlier, from) : null
    if (deleted) events.push(deleted)
    const rich = parseRichText(text, this.imageFile)
    if (!text || !rich.length) return events
    const { event } = this.log.addMessage({ from, text, rich, run, ...target, ...(initiative ? { initiative } : {}) })
    this.rememberRun(run)
    if (event) events.push(event)
    return events
  }

  settle(slug: AgentSlug, runId: string): RoomEvent | null {
    const latest = this.latestAttempt(runId)
    if (latest === null) return null
    const stale = this.log.earlierAttempts(runId, latest)
    return stale.length ? this.log.deleteMessages(stale, { kind: "agent", slug }) : null
  }

  ended(runId: string): boolean {
    const cached = this.endedRuns.get(runId)
    if (cached !== undefined) return cached
    const found =
      this.sql.exec(`SELECT 1 FROM ${RECENT_MESSAGES} WHERE run_id = ? LIMIT 1`, this.log.roomId, runId).toArray()
        .length > 0
    remember(this.endedRuns, runId, found)
    return found
  }

  private latestAttempt(runId: string): number | null {
    const cached = this.latestAttempts.get(runId)
    if (cached !== undefined) return cached
    const latest = this.sql
      .exec<{ attempt: number | null }>(
        `SELECT MAX(run_attempt) AS attempt FROM ${RECENT_MESSAGES} WHERE run_id = ?`,
        this.log.roomId,
        runId,
      )
      .one().attempt
    remember(this.latestAttempts, runId, latest)
    return latest
  }

  private rememberRun(run: RunRef): void {
    const latest = this.latestAttempts.get(run.runId)
    if (latest === undefined || latest === null || run.attempt > latest)
      remember(this.latestAttempts, run.runId, run.attempt)
    remember(this.endedRuns, run.runId, true)
  }
}
