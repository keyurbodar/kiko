import { createMemo } from "solid-js"
import { room } from "../../state/room"
import { type DeskMode, deskMode } from "./desk-model"

export function useDeskMode(chatId: () => string): () => DeskMode {
  return createMemo(() => {
    const row = room.chatById(chatId())
    return deskMode({
      running: row !== undefined && row.presence !== "idle",
      tasks: room.tasks(),
      lanes: room.helpers(),
      asks: room.active()?.asks().length ?? 0,
    })
  })
}
