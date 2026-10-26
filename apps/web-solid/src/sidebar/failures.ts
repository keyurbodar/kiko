import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { seenInChat } from "../lib/errors"
import { onUserSignal } from "../state/user"
import type { Failures } from "./needs"

export function createFailuresElsewhere(activeId: () => string | null): () => Failures {
  const [failures, setFailures] = createSignal<Failures>(new Map())
  const stop = onUserSignal("error", (signal) => {
    const roomId = signal.roomId
    if (roomId === undefined || seenInChat(roomId, activeId(), document.visibilityState === "visible")) return
    setFailures((all) => new Map(all).set(roomId, signal.error.message))
  })
  onCleanup(stop)
  createEffect(
    on(activeId, (id) => {
      if (id === null) return
      setFailures((all) => {
        if (!all.has(id)) return all
        const next = new Map(all)
        next.delete(id)
        return next
      })
    }),
  )
  return failures
}
