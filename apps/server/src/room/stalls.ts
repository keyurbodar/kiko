import type { AgentSlug } from "@kiko/protocol"
import type { ChatTasks } from "../user/overview"

// Architecture section 25.6. Grok nudges a stalled handoff; kiko does it without a model. Once an
// hour while the board has open work, the room looks for tasks nobody touched for a day and wakes
// whoever should move them: the owner for work in progress, the lead for work waiting for review.

export const LOOPS_WAKEUP = "loops"
export const SWEEP_MS = 3_600_000
export const STALE_MS = 24 * 3_600_000
/** The most nudges one room sends a day. */
export const MAX_NUDGES = 5

type TaskRow = { id: string; title: string; status: string; owner: string | null; updated_at: number }

export type Nudge = { taskId: string; title: string; status: string; to: AgentSlug }

/** Tasks untouched past `STALE_MS`, and who each nudge goes to. Pure. */
export function stalled(tasks: readonly TaskRow[], lead: AgentSlug | null, now: number): Nudge[] {
  const out: Nudge[] = []
  for (const t of tasks) {
    if (now - t.updated_at < STALE_MS) continue
    const to = t.status === "review" ? lead : t.status === "doing" || t.status === "blocked" ? (t.owner as AgentSlug | null) : null
    if (to) out.push({ taskId: t.id, title: t.title, status: t.status, to })
  }
  return out
}

export function openTasks(sql: SqlStorage): TaskRow[] {
  const exists = sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ws_tasks'").toArray().length > 0
  if (!exists) return []
  return sql.exec<TaskRow>("SELECT id, title, status, owner, updated_at FROM ws_tasks WHERE status NOT IN ('done', 'cancelled') ORDER BY updated_at").toArray()
}

/** The room's open tasks as the overview shows them. */
export function chatTasks(rows: readonly TaskRow[]): ChatTasks {
  return { open: rows.length, oldest: rows.slice(0, 3).map((t) => ({ title: t.title, status: t.status, ...(t.owner ? { owner: t.owner } : {}), updatedAt: t.updated_at })) }
}

export function nudgeBody(n: Nudge): string {
  return n.status === "review"
    ? `task ${n.taskId} "${n.title}" has waited for review for over a day. review it now: move it to done, or back to doing with a note.`
    : `task ${n.taskId} "${n.title}" has been ${n.status} for over a day with no change. move it forward, or tell the human in one line what's in the way.`
}
