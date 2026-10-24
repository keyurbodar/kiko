import { createMemo, createRoot, createSignal, untrack } from "solid-js"
import { createQuery, owner } from "../state/runtime"
import { room } from "../state/room"
import { user } from "../state/user"
import { withMade } from "./api"
import { mergeLibrary } from "./library-model"
import { HOME } from "./model"

function createLibrary() {
  const [wanted, setWanted] = createSignal(false)
  const listing = createQuery(() => (wanted() ? owner.queries.ownerFiles(undefined) : null))
  const chats = createMemo(() => new Set(user.chats().map((c) => c.roomId as string)))
  const files = createMemo(() => {
    const activeId = room.activeId()
    return mergeLibrary({
      listed: listing() ?? [],
      home: withMade(HOME, user.homeFiles()),
      activeId,
      active: activeId ? withMade(activeId, room.files()) : [],
      chats: chats(),
    })
  })
  const want = () => {
    if (!untrack(wanted)) setWanted(true)
  }
  const use = () => {
    if (untrack(wanted)) listing.refetch()
    else setWanted(true)
  }
  return { files, loading: () => listing.loading, want, use }
}

export const library = createRoot(createLibrary)
