import type { AgentSlug } from "@yuki/protocol"
import type { ChatTasks } from "../user/overview"

// Architecture section 25.6. Grok nudges a stalled handoff; yuki does it without a model. Once an
// hour while the board has open work, the room looks for tasks nobody touched for a day and wakes
// whoever should move them: the owner for work in progress, the lead for work waiting for review.

export const LOOPS_WAKEUP = "loops"
/** The soonest the sweep comes back, so a burst of task edits never makes it run often. */
export const SWEEP_MS = 3_600_000
export const STALE_MS = 24 * 3_600_000
/** The most nudges one room sends a day. */
export const MAX_NUDGES = 5

type TaskRow = { id: string; title: string; status: string; owner: string | null; updated_at: number }

export type Nudge = { id: string; taskId: string; title: string; status: string; to: AgentSlug }

/** Work someone should be moving: the owner's for doing and blocked, the lead's for review. */
const NUDGEABLE = new Set(["doing", "blocked", "review"])

/**
 * The delivery id of a task's nudge. It names the task's last change, so one stretch of staleness is
 * nudged once: an answer that does not move the task is not asked again until someone touches it.
 */
export const nudgeId = (t: Pick<TaskRow, "id" | "updated_at">) => `stalled:${t.id}:${t.updated_at}`

/** Tasks untouched past `STALE_MS` and not nudged yet for that stretch, and who each nudge goes to. Pure. */
export function stalled(tasks: readonly TaskRow[], lead: AgentSlug | null, now: number, nudged: (id: string) => boolean): Nudge[] {
  const out: Nudge[] = []
  for (const t of tasks) {
    if (!NUDGEABLE.has(t.status) || now - t.updated_at < STALE_MS || nudged(nudgeId(t))) continue
    const to = t.status === "review" ? lead : (t.owner as AgentSlug | null)
    if (to) out.push({ id: nudgeId(t), taskId: t.id, title: t.title, status: t.status, to })
  }
  return out
}

/**
 * When the sweep next has something to do: the moment the first nudgeable task that was not nudged
 * yet goes stale, never sooner than `SWEEP_MS` from now. Null when there is none, so a board of todo
 * items, or of work already nudged, costs no wakeup at all.
 */
export function nextSweep(tasks: readonly TaskRow[], now: number, nudged: (id: string) => boolean): number | null {
  const waiting = tasks.filter((t) => NUDGEABLE.has(t.status) && !nudged(nudgeId(t)))
  if (!waiting.length) return null
  return Math.max(Math.min(...waiting.map((t) => t.updated_at + STALE_MS)), now + SWEEP_MS)
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
