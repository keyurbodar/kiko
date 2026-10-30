import { createEffect, createSignal, onCleanup } from "solid-js"
import type { ChatMessage } from "../lib/types"
import { seenInChat } from "../lib/errors"
import { onUserSignal } from "../state/user"
import { type Failures, failureOf, loadedFor } from "./needs"

export function createKnownFailures(input: {
  activeId: () => string | null
  messages: () => readonly ChatMessage[]
}): () => Failures {
  const [failures, setFailures] = createSignal<Failures>(new Map())
  const put = (roomId: string, text: string | undefined) =>
    setFailures((all) => {
      if (all.get(roomId) === text) return all
      const next = new Map(all)
      if (text === undefined) next.delete(roomId)
      else next.set(roomId, text)
      return next
    })
  const stop = onUserSignal("error", (signal) => {
    const roomId = signal.roomId
    if (roomId === undefined || seenInChat(roomId, input.activeId(), document.visibilityState === "visible")) return
    put(roomId, signal.error.message)
  })
  onCleanup(stop)
  createEffect(() => {
    const id = input.activeId()
    const messages = input.messages()
    if (id === null || !loadedFor(messages, id)) return
    put(id, failureOf(messages, () => {})?.text)
  })
  return failures
}
