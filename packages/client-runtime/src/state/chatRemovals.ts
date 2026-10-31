import type { RoomId } from "@kiko/protocol"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

export class ChatRemovals extends Context.Service<
  ChatRemovals,
  {
    readonly isRemoved: (roomId: RoomId) => boolean
    readonly remove: (roomId: RoomId) => Effect.Effect<void>
  }
>()("@kiko/client-runtime/state/ChatRemovals") {}

export const layer = Layer.sync(ChatRemovals, () => {
  const removed = new Set<RoomId>()
  return ChatRemovals.of({
    isRemoved: (roomId) => removed.has(roomId),
    remove: (roomId) => Effect.sync(() => void removed.add(roomId)),
  })
})
