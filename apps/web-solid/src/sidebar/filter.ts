import type { RosterBot } from "../lib/types"

export interface ListFilter {
  query: string
  unreadOnly: boolean
}

/**
 * The rows the search field and the filter button leave visible. Local and
 * synchronous: it matches the title and the preview, case-insensitively, and
 * never asks the network. Order is kept, so pinned-first order survives.
 * `unreadOf` lets the caller count a chat marked unread by hand.
 */
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
