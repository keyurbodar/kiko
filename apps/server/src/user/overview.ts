import { listChats } from "./chats"
import { localTime, type Reminder, type RoutineRun } from "./reminders"

export type ChatTasks = { open: number; oldest: { id?: string; title: string; status: string; owner?: string; updatedAt: number }[] }

/** Writes the board summary a room reports. No open task drops the row, so the initiative pass sees no board. */
export function setBoardRow(sql: SqlStorage, roomId: string, tasks: ChatTasks): void {
  if (!tasks.open) {
    sql.exec("DELETE FROM chat_tasks WHERE room_id = ?", roomId)
    return
  }
  sql.exec("INSERT INTO chat_tasks (room_id, tasks) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET tasks = excluded.tasks", roomId, JSON.stringify(tasks))
}

/** A deleted chat's board goes with it. */
export function removeBoardRow(sql: SqlStorage, roomId: string): number {
  return sql.exec("DELETE FROM chat_tasks WHERE room_id = ?", roomId).rowsWritten
}

function taskRows(sql: SqlStorage): { room_id: string; tasks: string }[] {
  return sql.exec<{ room_id: string; tasks: string }>("SELECT room_id, tasks FROM chat_tasks").toArray()
}

const MAX_CHATS = 12
const DAY = 86_400_000

const ago = (at: number, now: number) => {
  const h = Math.round((now - at) / 3_600_000)
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

export function overview(sql: SqlStorage, input: { reminders: Reminder[]; runs: RoutineRun[]; tz: string; now: number }): string {
  const { now, tz } = input
  const chats = listChats(sql)
  const titles = new Map(chats.map((c) => [c.roomId as string, c.title]))
  const tasks = new Map(
    taskRows(sql).map((r) => [r.room_id, JSON.parse(r.tasks) as ChatTasks]),
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
  const soon = routines.filter((r) => r.status === "active" && r.dueUtc > 0 && r.dueUtc - now < DAY)
  if (soon.length) out.push("routines due in the next day:", ...soon.slice(0, 10).map((r) => `- ${localTime(r.dueUtc, tz)}: "${r.name}" by @${r.target}`))
  return out.join("\n")
}
