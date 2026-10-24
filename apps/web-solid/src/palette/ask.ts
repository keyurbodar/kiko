import { createEffect, createRoot, untrack } from "solid-js"
import { openChat } from "../app/history"
import { requestJump } from "../search/state"
import type { Hit } from "../search/model"
import { room } from "../state/room"
import { user } from "../state/user"

export function askKiko(text: string): void {
  const id = user.kikoChatId()
  if (!id) return
  if (room.activeId() === id) return void room.send({ body: text })
  openChat(id)
  createRoot((dispose) => {
    createEffect(() => {
      if (room.activeId() !== id) return
      dispose()
      untrack(() => room.send({ body: text }))
    })
  })
}

export function openHit(hit: Hit): void {
  requestJump({ roomId: hit.roomId, id: hit.id, seq: hit.seq })
  if (hit.roomId !== room.activeId()) openChat(hit.roomId)
}
