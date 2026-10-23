import type { ErrorAction } from "@kiko/protocol"
import { showToastV2, type ToastV2Action, type ToastV2Options } from "@kiko/ui/v2/toast-v2"
import { openSettings } from "../settings/open"

const PLAIN_ERROR_MS = 10_000

export { openSettings }

const ACTIONS: Record<ErrorAction, { label: string; run: () => void }> = {
  open_models: { label: "Open settings", run: () => openSettings("models") },
  open_integrations: { label: "Open settings", run: () => openSettings("tools") },
}

function errorToast(message: string, action?: ToastV2Action | undefined): ToastV2Options & { title: string } {
  return { title: message, variant: "error", ...(action ? { action, persistent: true } : { duration: PLAIN_ERROR_MS }) }
}

export function showFailure(message: string, action?: ToastV2Action): number | undefined {
  return showToastV2(errorToast(message, action))
}

function showMissing(message: string, action: ErrorAction): number | undefined {
  return showFailure(message, { label: ACTIONS[action].label, onClick: ACTIONS[action].run })
}

export type Notice = { readonly message: string; readonly action?: ErrorAction }

export function showNotice(error: Notice): number | undefined {
  return error.action ? showMissing(error.message, error.action) : showFailure(error.message)
}

export const seenInChat = (roomId: string | undefined, openChat: string | null, tabVisible: boolean): boolean =>
  roomId !== undefined && roomId === openChat && tabVisible
