import type { CatalogItem } from "@kiko/protocol"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { useApp } from "../../lib/store"
import type { CatalogPage } from "../../sync/room-store"

/**
 * Merges a fresh first page into what the list already holds. The fresh page replaces the
 * newest messages, so a deleted message leaves and a new one arrives. Items older than the
 * page stay, with the cursor they already had, so a reader who paged down keeps their place.
 */
export function mergeCatalog(
  held: readonly CatalogItem[],
  heldNext: number | null,
  first: CatalogPage,
): { items: CatalogItem[]; next: number | null } {
  const oldest = first.items.at(-1)?.seq
  if (first.next === null || oldest === undefined) return { items: [...first.items], next: first.next }
  const older = held.filter((item) => item.seq < oldest)
  if (!older.length) return { items: [...first.items], next: first.next }
  return { items: [...first.items, ...older], next: heldNext }
}

/*
 * The links or the media sent in the open room, newest first. It asks the room socket for the
 * first page, and asks again whenever the room's log moves, so a link or a picture sent while the
 * panel is open shows without a reload. `more()` pages further back.
 */
export function createCatalog(kind: "links" | "media", pageSize = 30) {
  const [items, setItems] = createSignal<CatalogItem[]>([])
  const [next, setNext] = createSignal<number | null>(null)
  const [loaded, setLoaded] = createSignal(false)
  let busy = false
  let gone = false
  onCleanup(() => (gone = true))

  async function refresh() {
    const room = useApp.room()
    if (!room) return
    const page = await room.catalog(kind, undefined, pageSize)
    if (gone || !page) return
    const merged = mergeCatalog(items(), next(), page)
    setItems(merged.items)
    setNext(merged.next)
    setLoaded(true)
  }

  async function more() {
    const room = useApp.room()
    const before = next()
    if (!room || before === null || busy) return
    busy = true
    try {
      const page = await room.catalog(kind, before, pageSize)
      if (gone || !page) return
      setItems((held) => [...held, ...page.items])
      setNext(page.next)
    } finally {
      busy = false
    }
  }

  // A different room starts empty. The same room asks again when its log moves.
  createEffect(
    on(
      () => useApp.room()?.state.roomId,
      () => {
        setItems([])
        setNext(null)
        setLoaded(false)
      },
    ),
  )
  createEffect(() => {
    const room = useApp.room()
    if (!room || room.state.connection !== "open") return
    // Read the seq so every stored event asks again.
    void room.state.seq
    void refresh()
  })

  return { items, hasMore: () => next() !== null, more, loaded }
}
