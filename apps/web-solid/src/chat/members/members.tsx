import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, onCleanup } from "solid-js"
import { useApp } from "../../lib/store"
import { refusalText } from "./model"

/** Toasts each refusal from the open room while the calling view is on screen. */
export function useRefusalToasts() {
  createEffect(() => {
    if (!useApp.room()) return
    const off = useApp.onMemberRefused((op, reason) => showToastV2({ title: refusalText(op, reason), variant: "error" }))
    onCleanup(off)
  })
}
