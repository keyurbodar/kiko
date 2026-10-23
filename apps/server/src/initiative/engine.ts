import type { AgentSlug } from "@kiko/protocol"
import type { UserSettings } from "@kiko/protocol/schema"
import { validZone } from "@kiko/sandbox/recurrence"
import type { WakeResult } from "../room/delivery"

export const INITIATIVE_RUN = "initiative"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const RENUDGE_MS = 3 * DAY
const KEEP_MS = 90 * DAY
const TRIES = 5
const PER_PASS = { digest: 1, active: 3 }

export type Level = UserSettings["initiative"]

type WakeInput = { id: string; to: AgentSlug | null; body: string; reason: string }

type BoardTask = { id?: string; title: string; status: string; owner?: string; updatedAt: number }

type Board = { roomId: string; oldest: readonly BoardTask[] }

type EngineDeps = {
  sql: SqlStorage
  tz: () => string
  level: () => Level
  boards: () => readonly Board[]
  title: (roomId: string) => string | null
  wake: (roomId: string, input: WakeInput) => Promise<WakeResult | "busy">
  count: (delta: Record<string, number>) => void
}

type PassReport = { at: number; woke: { id: string; room: string; to: string; result: WakeResult | "busy" }[] }

export class InitiativeEngine {
  constructor(private readonly d: EngineDeps) {}

  private boards(): Board[] {
    return [...this.d.boards()]
  }

  private due(now: number): { room: string; task: BoardTask & { id: string } }[] {
    const seen = new Set(
      this.d.sql
        .exec<{ ids: string }>("SELECT ids FROM initiative_wakes WHERE at > ?", now - RENUDGE_MS)
        .toArray()
        .map((r) => r.ids),
    )
    return this.boards()
      .flatMap((board) => {
        const task = board.oldest.find((t) => t.id && !seen.has(`task:${board.roomId}:${t.id}`))
        return task?.id ? [{ room: board.roomId, task: { ...task, id: task.id } }] : []
      })
      .sort((a, b) => a.task.updatedAt - b.task.updatedAt)
  }

  async pass(now = Date.now()): Promise<PassReport> {
    this.prune(now)
    const report: PassReport = { at: now, woke: [] }
    const level = this.d.level()
    if (level !== "digest" && level !== "active") return report
    const raised = new Set<string>()
    let tried = 0
    let landed = 0
    for (const { room: roomId, task } of this.due(now)) {
      if (this.d.title(roomId) === null || raised.has(roomId)) continue
      if (++tried > TRIES) break
      const own = task.owner !== undefined
      const id = `task:${roomId}:${task.id}#${Math.floor(now / DAY)}`
      const result = await this.d.wake(roomId, {
        id,
        to: own ? (task.owner as AgentSlug) : null,
        body: wakeBody(task, own, now),
        reason: `${own ? `Promised ${day(task.updatedAt, this.d.tz())}` : `Not touched since ${day(task.updatedAt, this.d.tz())}`}`,
      })
      report.woke.push({ id, room: roomId, to: own ? (task.owner as string) : "lead", result })
      if (result === "delivered" || result === "duplicate") {
        this.d.sql.exec(
          "INSERT OR IGNORE INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES (?, ?, ?, ?, ?, ?, 'sent')",
          id,
          roomId,
          own ? (task.owner as string) : "lead",
          task.status,
          `task:${roomId}:${task.id}`,
          now,
        )
        this.d.count({ initiative_woke: 1 })
        raised.add(roomId)
        if (++landed >= PER_PASS[level]) break
      }
    }
    return report
  }

  private prune(now: number): void {
    this.d.sql.exec("DELETE FROM initiative_wakes WHERE at < ?", now - KEEP_MS)
  }
}

const NUDGE_RULE =
  "one short message in your own words, at most two sentences. no text around tool calls. reply only [skip] when this chat shows it is already handled."

function wakeBody(task: BoardTask & { id: string }, own: boolean, now: number): string {
  const line = `${task.id} [${task.status}] ${task.title}${task.owner ? ` (owner @${task.owner})` : ""} (last changed ${ago(task.updatedAt, now)})`
  if (own) {
    return [
      `initiative: this task is yours and it is still open: ${line}.`,
      "move it on now in one short message: the result, or one line on why you cannot. no text around tool calls.",
      "then set its status with update_task. if this chat shows it is already done, close it and reply only [skip].",
    ].join("\n")
  }
  return [
    `initiative: this task is still open:\n- ${line}`,
    `raise it now: ${NUDGE_RULE} if it is a teammate's work, ask that teammate with send_message instead.`,
    "if the human says it is no longer wanted, cancel it with update_task.",
  ].join("\n")
}

function day(at: number, tz: string): string {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: validZone(tz) ? tz : "UTC",
  })
}

function span(ms: number): string {
  const h = Math.round(ms / HOUR)
  return h < 36 ? `${Math.max(1, h)} hours` : `${Math.round(h / 24)} days`
}

function ago(at: number, now: number): string {
  return now - at < HOUR ? "just now" : `${span(now - at)} ago`
}
