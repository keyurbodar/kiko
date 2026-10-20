import type { RosterBot } from "../lib/types"

export interface ListFilter {
  query: string
  unreadOnly: boolean
}

export function filterRows(
  rows: readonly RosterBot[],
  filter: ListFilter,
  unreadOf: (row: RosterBot) => boolean = (row) => row.unread > 0,
): RosterBot[] {
  const query = filter.query.trim().toLowerCase()
  if (query === "" && !filter.unreadOnly) return [...rows]
  return rows.filter((row) => {
    if (filter.unreadOnly && !unreadOf(row)) return false
    if (query === "") return true
    return row.name.toLowerCase().includes(query) || row.preview.toLowerCase().includes(query)
  })
}

export function pinnedRows(rows: readonly RosterBot[], mainId: string | null | undefined): RosterBot[] {
  const pinned = rows.filter((row) => row.pinned)
  return [...pinned.filter((row) => row.id === mainId), ...pinned.filter((row) => row.id !== mainId)]
}
