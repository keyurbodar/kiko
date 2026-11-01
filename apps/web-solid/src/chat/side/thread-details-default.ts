import { THREAD_DETAILS_ITEMS, type ThreadDetailsItemId, type ThreadDetailsVisibility } from "./thread-details-items"

export type ThreadDetailsPresence = Readonly<Record<ThreadDetailsItemId, boolean>>

export function threadDetailsShows(visibility: ThreadDetailsVisibility, presence: ThreadDetailsPresence): boolean {
  return THREAD_DETAILS_ITEMS.some((item) => visibility[item.id] && presence[item.id])
}

export function threadDetailsDefaultOpen(input: {
  desktop: boolean
  hasHistory: boolean
  visibility: ThreadDetailsVisibility
  presence: ThreadDetailsPresence
}): boolean {
  return input.desktop && input.hasHistory && threadDetailsShows(input.visibility, input.presence)
}
