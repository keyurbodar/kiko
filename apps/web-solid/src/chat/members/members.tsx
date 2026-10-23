import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, onCleanup } from "solid-js"
import { room } from "../../state/room"
import { refusalText } from "./model"

export function useRefusalToasts() {
  createEffect(() => {
    if (!room.activeId()) return
    const off = room.onMemberRefused((op, reason) => showToastV2({ title: refusalText(op, reason), variant: "error" }))
    onCleanup(off)
  })
}
