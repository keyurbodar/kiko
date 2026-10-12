import type { Alarms } from "@yuki/durable/alarm"
import type { Life } from "@yuki/memory/life"
import { type Certainty, type Loop, Loops, type LoopKind, type OpenResult } from "@yuki/memory/loops"
import type { RoomId } from "@yuki/protocol"
import { INITIATIVE_LEVELS, type LoopAction, type LoopRow } from "@yuki/protocol/schema"
import type { Env } from "../index"
import { Initiative } from "../initiative/initiative"
import type { Level } from "../initiative/attention/types"
import { INITIATIVE_WAKEUP, InitiativeEngine } from "../initiative/engine"
import { roomStub } from "../lib/names"
import { getSetting } from "../lib/settings"
import { getChat } from "./chats"
import { AWAY_MS, LAST_SEEN } from "./keys"
import { type MemoryCapture, CAPTURE_TEXT_MAX, CAPTURE_TIMEOUT_MS } from "./memory-capture"
import type { Reminders } from "./reminders"
import { DEFAULT_TIMEZONE } from "./turn-context"
import { yukiChatRoom } from "./yuki-chat"

export const LOOPS_WAKEUP = "loops_heard"
const LOOPS_DELAY_MS = 15_000
const LOOPS_ROOMS_PER_PASS = 8
// Jev passes a burst may fail before the two-word touch decides it.
const LOOPS_TRIES = 3

export type LoopsDeps = {
  sql: SqlStorage
  transaction: <T>(fn: () => T) => T
  alarms: Alarms
  life: Life
  memory: MemoryCapture
  reminders: Reminders
  room: Env["ROOM"]
  userId: string
}

function loopRow(l: Loop): LoopRow {
  return { id: l.id, kind: l.kind, certainty: l.certainty, owner: l.owner, room: l.room, due: l.due, status: l.status, text: l.text, snoozedUntil: l.snoozedUntil }
}

export class InitiativeLoops {
  readonly loops: Loops
  readonly initiative: Initiative
  readonly engine: InitiativeEngine
  private readonly d: LoopsDeps

  constructor(d: LoopsDeps) {
    this.d = d
    this.loops = new Loops(d.sql, d.transaction)
    // A chat the human keeps private never reaches initiative. A temporary chat reaches only the loops it already holds.
    const title = (roomId: string, withTemp: boolean) => {
      const chat = getChat(d.sql, roomId)
      return chat && !chat.private && (withTemp || !chat.temp) ? chat.title : null
    }
    this.initiative = new Initiative({
      loops: this.loops,
      life: d.life,
      judge: () => d.memory.judgeFor(CAPTURE_TIMEOUT_MS),
      title: (roomId) => title(roomId, true),
      off: () => this.level() === "off",
      count: (delta) => d.memory.count(delta),
      close: (id, status, at, room) => this.closeLoop(id, status, at, room),
      noticed: (roomId, skip) => this.engine.noticed(roomId, skip),
      nudges: (roomId) => this.engine.nudges(roomId),
      answered: (roomId, loop, messageId, at) => this.engine.answered(roomId, loop, messageId, at),
    })
    this.engine = new InitiativeEngine({
      sql: d.sql,
      loops: this.loops,
      tz: () => getSetting(d.sql, "timezone") ?? DEFAULT_TIMEZONE,
      level: () => this.level(),
      away: () => {
        const last = getSetting(d.sql, LAST_SEEN)
        return last !== null && Date.now() - Number(last) > AWAY_MS
      },
      title: (roomId) => title(roomId, false),
      home: () => yukiChatRoom(d.sql),
      routines: () => {
        const runs = d.reminders.runs()
        return d.reminders.triggered().map((routine) => ({ routine, last: runs.find((x) => x.routineId === routine.id && x.status !== "running") ?? null }))
      },
      judge: () => d.memory.judgeFor(CAPTURE_TIMEOUT_MS),
      judged: (roomId) => this.judging(roomId as RoomId),
      wake: (roomId, input) => roomStub(d.room, d.userId, roomId).initiativeWake(input),
      count: (delta) => d.memory.count(delta),
      setWakeup: (at) => d.alarms.setWakeup(INITIATIVE_WAKEUP, at),
      clearWakeup: () => d.alarms.clearWakeup(INITIATIVE_WAKEUP),
    })
  }

  level(): Level {
    const level = getSetting(this.d.sql, "initiative")
    return (INITIATIVE_LEVELS as readonly string[]).includes(level ?? "") ? (level as Level) : "digest"
  }

  /** A reminder an agent set for itself opens its commitment (section 26.2); a dev route opens a loop for the fake-agent suite. */
  async open(owner: string, roomId: RoomId, ref: string, input: { kind: LoopKind; certainty: Certainty; text: string; due: string | null; reminderId?: string }): Promise<OpenResult> {
    if (!this.d.memory.capturable(roomId)) return { ok: false, error: "this chat is private: nothing here is kept." }
    const { reminderId, ...loop } = input
    const out = this.loops.open({ ...loop, owner, room: roomId, ref, source: "tool" })
    if (out.ok) {
      this.d.memory.count(out.merged ? { loops_merged: 1 } : { loops_opened: 1 })
      if (reminderId) this.engine.link(reminderId, out.id)
      await this.engine.arm()
    }
    return out
  }

  /** `roomId`: an agent's close, which reaches only the loops of its own chat. */
  close(id: number, status: "done" | "dropped", roomId?: RoomId): boolean {
    return this.closeLoop(id, status, Date.now(), roomId)
  }

  /** Every close goes through here: a drop settles a nudge about the loop as dismissed (section 26.6). */
  private closeLoop(id: number, status: "done" | "dropped", at: number, roomId?: string): boolean {
    const closed = this.loops.close(id, status, at, roomId)
    if (closed) this.d.memory.count({ loops_closed: 1 })
    if (closed && status === "dropped") this.engine.dropped(id, at)
    return closed
  }

  humanLoops(roomId: string | null): LoopRow[] {
    return this.loops.list({ owner: "human", status: ["open", "snoozed"], ...(roomId ? { room: roomId } : {}), limit: 200 }).map(loopRow)
  }

  async act(id: number, action: LoopAction): Promise<boolean> {
    if (this.loops.get(id)?.owner !== "human") return false
    if (action.action === "snooze") return this.loops.snooze(id, action.until, Date.now())
    return this.close(id, action.action === "done" ? "done" : "dropped")
  }

  /** Whether Jev reads this chat's bursts: a judge key, capture on, initiative on, and a chat that may be kept. */
  judging(roomId: RoomId): boolean {
    return this.d.memory.captures() && this.level() !== "off" && this.d.memory.capturable(roomId)
  }

  /** Queues a human burst, or an agent's answer, for one Jev pass. Without a judge, with capture off, or with initiative off, nothing is queued. */
  async hear(roomId: RoomId, items: { messageId: string; text: string; at: number }[], agent = ""): Promise<void> {
    if (!this.judging(roomId)) return
    const rows = items.filter((i) => i.messageId && i.text.trim()).map((i) => ({ id: i.messageId, text: i.text.slice(0, CAPTURE_TEXT_MAX), at: i.at }))
    if (!rows.length) return
    // A wakeup is already set while anything waits: pushing it on each burst would starve Jev in a steady chat.
    const waiting = this.d.sql.exec("SELECT 1 FROM loop_heard LIMIT 1").toArray().length > 0
    this.d.sql.exec(
      "INSERT OR IGNORE INTO loop_heard (room_id, message_id, text, at, agent) SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.text'), json_extract(value, '$.at'), ? FROM json_each(?)",
      roomId,
      agent,
      JSON.stringify(rows),
    )
    if (!waiting) await this.d.alarms.setWakeup(LOOPS_WAKEUP, Date.now() + LOOPS_DELAY_MS)
  }

  async now(): Promise<void> {
    const rows = this.d.sql.exec<{ room_id: RoomId; message_id: string; text: string; at: number; agent: string; attempts: number }>("SELECT * FROM loop_heard ORDER BY at LIMIT 48").toArray()
    const rooms = new Map<RoomId, typeof rows>()
    for (const r of rows) rooms.set(r.room_id, [...(rooms.get(r.room_id) ?? []), r])
    // One Jev call per chat, and an invocation has 50 subrequests: the rest wait for the next alarm.
    let retry = false
    for (const [roomId, burst] of [...rooms].slice(0, LOOPS_ROOMS_PER_PASS)) {
      const ids = JSON.stringify(burst.map((r) => r.message_id))
      const out = await this.initiative.heard(roomId, burst.map((r) => ({ messageId: r.message_id, text: r.text, at: r.at, ...(r.agent ? { by: r.agent } : {}) })))
      if (out === "later") {
        this.d.memory.count({ loops_jev_failed: 1 })
        // Keep the burst for another pass. Once the tries run out, the two-word touch counts a reply, so a nudge is not settled as ignored.
        if (Math.max(...burst.map((r) => r.attempts)) + 1 < LOOPS_TRIES) {
          this.d.sql.exec("UPDATE loop_heard SET attempts = attempts + 1 WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?))", roomId, ids)
          retry = true
          continue
        }
        for (const r of burst) this.engine.fallback(roomId, r.text, r.message_id, r.at)
      }
      this.d.sql.exec("DELETE FROM loop_heard WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?))", roomId, ids)
    }
    if (this.d.sql.exec<{ n: number }>("SELECT count(*) AS n FROM loop_heard").one().n) await this.d.alarms.setWakeup(LOOPS_WAKEUP, Date.now() + (retry ? LOOPS_DELAY_MS : 0))
  }
}
