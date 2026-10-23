import type { MessageId, RoomId } from "@kiko/protocol"
import { createSignal } from "solid-js"
import type { Warm } from "./db"

export type Draft = {
  roomId: RoomId
  text: string
  replyTo?: MessageId
  updatedAt: number
}

function saveDraft(warm: Warm, draft: Draft) {
  if (draft.text === "" && !draft.replyTo) warm.delete("drafts", draft.roomId)
  else warm.put("drafts", draft.roomId, draft)
}

const allDrafts = (warm: Warm) => warm.getAll<Draft>("drafts")

const scrollKey = (roomId: RoomId | string) => `scroll:${roomId}`

export function clearDraft(warm: Warm, roomId: RoomId) {
  warm.delete("drafts", roomId)
  warm.delete("meta", scrollKey(roomId))
}

export type ScrollPosition = {
  messageId: MessageId | string
  offset: number
}

const saveScroll = (warm: Warm, roomId: RoomId | string, position: ScrollPosition | null) => {
  if (position) warm.put("meta", scrollKey(roomId), { ...position, roomId })
  else warm.delete("meta", scrollKey(roomId))
}

const DRAFT_DEBOUNCE_MS = 300

export function createDraftBook(warm: Warm, debounceMs = DRAFT_DEBOUNCE_MS) {
  const drafts = new Map<string, Draft>()
  const scrolls = new Map<string, ScrollPosition>()
  const [version, setVersion] = createSignal(0)
  const [ready, setReady] = createSignal(false)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const scrollTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let closed = false

  const persist = (roomId: string) => {
    const timer = timers.get(roomId)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(roomId)
    const draft = drafts.get(roomId)
    if (!draft) warm.delete("drafts", roomId)
    else saveDraft(warm, draft)
  }

  void Promise.all([
    allDrafts(warm),
    warm.getAll<ScrollPosition & { roomId: string }>("meta", { lower: "scroll:", upper: "scroll:\uffff" }),
  ]).then(([all, saved]) => {
    if (closed) return
    for (const { roomId, ...position } of saved) if (!scrolls.has(roomId)) scrolls.set(roomId, position)
    for (const d of all) if (!drafts.has(d.roomId)) drafts.set(d.roomId, d)
    setReady(true)
    setVersion((v) => v + 1)
  })

  const book = {
    ready,
    get: (roomId: string): Draft | undefined => drafts.get(roomId),
    has(roomId: string): boolean {
      version()
      return (drafts.get(roomId)?.text ?? "") !== ""
    },
    save(roomId: string, patch: { text?: string; replyTo?: MessageId | null }) {
      const before = drafts.get(roomId)
      const next: Draft = {
        roomId: roomId as RoomId,
        text: patch.text ?? before?.text ?? "",
        updatedAt: Date.now(),
      }
      const replyTo = patch.replyTo === undefined ? before?.replyTo : (patch.replyTo ?? undefined)
      if (replyTo) next.replyTo = replyTo
      if (before && before.text === next.text && before.replyTo === next.replyTo) return
      if (next.text === "" && !next.replyTo) drafts.delete(roomId)
      else drafts.set(roomId, next)
      if (((before?.text ?? "") === "") !== (next.text === "")) setVersion((v) => v + 1)
      clearTimeout(timers.get(roomId))
      timers.set(
        roomId,
        setTimeout(() => {
          timers.delete(roomId)
          if (next.text === "" && !next.replyTo) warm.delete("drafts", roomId)
          else warm.put("drafts", roomId, drafts.get(roomId))
        }, debounceMs),
      )
    },
    scroll: (roomId: string) => scrolls.get(roomId),
    saveScroll(roomId: string, position: ScrollPosition | null) {
      if (position) scrolls.set(roomId, position)
      else scrolls.delete(roomId)
      clearTimeout(scrollTimers.get(roomId))
      scrollTimers.set(
        roomId,
        setTimeout(() => {
          scrollTimers.delete(roomId)
          saveScroll(warm, roomId, scrolls.get(roomId) ?? null)
        }, debounceMs),
      )
    },
    flush() {
      for (const roomId of Array.from(timers.keys())) persist(roomId)
      for (const [roomId, timer] of scrollTimers) {
        clearTimeout(timer)
        saveScroll(warm, roomId, scrolls.get(roomId) ?? null)
      }
      scrollTimers.clear()
      return warm.flush()
    },
    close() {
      closed = true
      globalThis.removeEventListener?.("pagehide", onHide)
      void book.flush()
    },
  }
  function onHide() {
    void book.flush()
  }
  globalThis.addEventListener?.("pagehide", onHide)
  return book
}

export type DraftBook = ReturnType<typeof createDraftBook>
