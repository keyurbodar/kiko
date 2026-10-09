import { listChats } from "./chats"
import { localTime, type Reminder, type RoutineRun } from "./reminders"

// Architecture section 25.7. What yuki reads at its check-in: the open work across every chat, in a
// few short lines, so one tool call costs a few hundred tokens however many chats there are.

/** A room's open tasks, as the room reports them on every task change. */
export type ChatTasks = { open: number; oldest: { title: string; status: string; owner?: string; updatedAt: number }[] }

const MAX_CHATS = 12
const DAY = 86_400_000

const ago = (at: number, now: number) => {
  const h = Math.round((now - at) / 3_600_000)
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

export function overview(sql: SqlStorage, input: { reminders: Reminder[]; runs: RoutineRun[]; tz: string; now: number }): string {
  const { now, tz } = input
  const chats = listChats(sql).filter((c) => !c.temp)
  const titles = new Map(chats.map((c) => [c.roomId as string, c.title]))
  const tasks = new Map(
    sql
      .exec<{ room_id: string; tasks: string }>("SELECT room_id, tasks FROM chat_tasks")
      .toArray()
      .map((r) => [r.room_id, JSON.parse(r.tasks) as ChatTasks]),
  )
  const out: string[] = []
  const recent = [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS)
  out.push("chats, newest first:")
  for (const c of recent) {
    const t = tasks.get(c.roomId)
    const open = t?.open ? `, ${t.open} open task${t.open > 1 ? "s" : ""}` : ""
    out.push(`- ${c.title} (${ago(c.updatedAt, now)}${c.unread ? `, ${c.unread} unread` : ""}${open}): ${c.lastPreview.replace(/\s+/g, " ").slice(0, 100)}`)
  }
  const stale = [...tasks.entries()].flatMap(([room, t]) => t.oldest.filter((x) => now - x.updatedAt > DAY).map((x) => `- ${titles.get(room) ?? "a chat"}: "${x.title}" ${x.status}${x.owner ? ` (@${x.owner})` : ""}, untouched ${ago(x.updatedAt, now)}`))
  if (stale.length) out.push("stale tasks:", ...stale.slice(0, 10))
  const routines = input.reminders.filter((r) => r.trigger && (r.status === "active" || r.status === "paused"))
  if (routines.length) {
    out.push("routines:")
    for (const r of routines.slice(0, 20)) {
      const last = input.runs.find((x) => x.routineId === r.id)
      out.push(`- "${r.name}" by @${r.target} in ${titles.get(r.roomId) ?? "a chat"}: ${r.status}${last ? `, last run ${last.status} ${ago(last.startedAt, now)}` : ", never run"}`)
    }
  }
  const soon = input.reminders.filter((r) => !r.trigger && r.status === "active" && r.dueUtc - now < DAY)
  if (soon.length) out.push("reminders in the next day:", ...soon.slice(0, 10).map((r) => `- ${localTime(r.dueUtc, tz)}: ${r.text.slice(0, 80)}${r.target === "human" ? "" : ` (for @${r.target})`}`))
  return out.join("\n")
}

/**
 * What the overview depends on, without the clock: each chat's sequence and unread count, the open
 * tasks, each routine's status and last run, and the reminders due. Equal fingerprints mean a
 * check-in would read the same thing as last time.
 */
export function overviewFingerprint(sql: SqlStorage, reminders: Reminder[], runs: RoutineRun[], self: { routineId: string | null; roomId: string | null }): string {
  // The check-in's own chat and its own runs change by its running, so they are left out.
  const chats = listChats(sql)
    .filter((c) => !c.temp && c.roomId !== self.roomId)
    .map((c) => `${c.roomId}:${c.lastSeq}:${c.unread}`)
  const tasks = sql.exec<{ room_id: string; tasks: string }>("SELECT room_id, tasks FROM chat_tasks ORDER BY room_id").toArray().map((r) => `${r.room_id}:${r.tasks}`)
  const routines = reminders.filter((r) => r.trigger && r.id !== self.routineId).map((r) => `${r.id}:${r.status}:${runs.find((x) => x.routineId === r.id)?.status ?? ""}`)
  const due = reminders.filter((r) => !r.trigger && r.status === "active").map((r) => `${r.id}:${r.dueUtc}`)
  return JSON.stringify([chats, tasks, routines, due])
}
