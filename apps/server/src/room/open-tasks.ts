import type { ChatTasks } from "../user/overview"

// Architecture section 26.6. Each room reports its open tasks to `UserDO.chatTasks` when they change.
// The initiative pass reads them as candidates; kiko's `overview` lists them.

type TaskRow = { id: string; title: string; status: string; owner: string | null; updated_at: number }

export function openTasks(sql: SqlStorage): TaskRow[] {
  const exists = sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ws_tasks'").toArray().length > 0
  if (!exists) return []
  return sql.exec<TaskRow>("SELECT id, title, status, owner, updated_at FROM ws_tasks WHERE status NOT IN ('done', 'cancelled') ORDER BY updated_at").toArray()
}

/** The room's open tasks as `UserDO` keeps them: the count and the three oldest. */
export function chatTasks(rows: readonly TaskRow[]): ChatTasks {
  return { open: rows.length, oldest: rows.slice(0, 3).map((t) => ({ id: t.id, title: t.title, status: t.status, ...(t.owner ? { owner: t.owner } : {}), updatedAt: t.updated_at })) }
}
