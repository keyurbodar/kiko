import type { MessageId, RoomId } from "@kiko/protocol"
import { createMemo, createRoot, createSignal } from "solid-js"
import { session } from "../app/session"
import { read, write } from "../lib/api-base"

export type Draft = {
  roomId: RoomId
  text: string
  replyTo?: MessageId
  updatedAt: number
}

export type ScrollPosition = {
  messageId: MessageId | string
  offset: number
}

const DRAFT_DEBOUNCE_MS = 300

function load<T>(key: string): Map<string, T> {
  try {
    const raw = read(key)
    return new Map(raw ? (Object.entries(JSON.parse(raw)) as [string, T][]) : [])
  } catch {
    return new Map()
  }
}

const save = <T>(key: string, map: ReadonlyMap<string, T>) =>
  write(key, map.size ? JSON.stringify(Object.fromEntries(map)) : null)

function createDraftBook(ownerId: string) {
  const draftsKey = `kiko:drafts:${ownerId}`
  const scrollKey = `kiko:scroll:${ownerId}`
  const drafts = load<Draft>(draftsKey)
  const scrolls = load<ScrollPosition>(scrollKey)
  const [version, setVersion] = createSignal(0)
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let scrollTimer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    clearTimeout(draftTimer)
    clearTimeout(scrollTimer)
    save(draftsKey, drafts)
    save(scrollKey, scrolls)
  }
  globalThis.addEventListener?.("pagehide", flush)

  return {
    ready: () => true,
    get: (roomId: string): Draft | undefined => drafts.get(roomId),
    has(roomId: string): boolean {
      version()
      return (drafts.get(roomId)?.text ?? "") !== ""
    },
    save(roomId: string, patch: { text?: string; replyTo?: MessageId | null }) {
      const before = drafts.get(roomId)
      const next: Draft = { roomId: roomId as RoomId, text: patch.text ?? before?.text ?? "", updatedAt: Date.now() }
      const replyTo = patch.replyTo === undefined ? before?.replyTo : (patch.replyTo ?? undefined)
      if (replyTo) next.replyTo = replyTo
      if (before && before.text === next.text && before.replyTo === next.replyTo) return
      if (next.text === "" && !next.replyTo) drafts.delete(roomId)
      else drafts.set(roomId, next)
      if (((before?.text ?? "") === "") !== (next.text === "")) setVersion((v) => v + 1)
      clearTimeout(draftTimer)
      draftTimer = setTimeout(() => save(draftsKey, drafts), DRAFT_DEBOUNCE_MS)
    },
    scroll: (roomId: string) => scrolls.get(roomId),
    saveScroll(roomId: string, position: ScrollPosition | null) {
      if (position) scrolls.set(roomId, position)
      else scrolls.delete(roomId)
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => save(scrollKey, scrolls), DRAFT_DEBOUNCE_MS)
    },
    flush,
    close() {
      globalThis.removeEventListener?.("pagehide", flush)
      flush()
    },
  }
}

export type DraftBook = ReturnType<typeof createDraftBook>

export const draftBook = createRoot(() =>
  createMemo<DraftBook | null>((previous) => {
    previous?.close()
    const current = session()
    return current.status === "signed-in" ? createDraftBook(current.user.id) : null
  }, null),
)
