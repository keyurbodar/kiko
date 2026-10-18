import type { ErrorAction, KikoError } from "@kiko/protocol"
import { showToastV2, type ToastV2Action, type ToastV2Options } from "@kiko/ui/v2/toast-v2"
import { openSettings } from "../settings/dialog-state"

/*
 * The one place an error becomes a toast. The server sends a KikoError (a sentence, an optional
 * action) and every other failure the client sees goes through `showFailure`. A toast with an action
 * stays until dismissed, because the human has something to do. One without goes away on its own.
 * The same toast again refreshes the one on screen, so a repeated failure never stacks.
 */

/** A toast with no action has nothing to wait for, so it closes sooner than a model error and later than a confirmation. */
const PLAIN_ERROR_MS = 10_000

/** The settings dialog's opener. The other places a failure offers settings (the composer's send block, a failed run's row, a provider to reconnect) open it from here. */
export { openSettings }

const ACTIONS: Record<ErrorAction, { label: string; run: () => void }> = {
  open_models: { label: "Open settings", run: () => openSettings("models") },
  open_integrations: { label: "Open settings", run: () => openSettings("tools") },
}

/** What a toast shows for an error, as data. */
export function errorToast(message: string, action?: ToastV2Action | undefined): ToastV2Options & { title: string } {
  return { title: message, variant: "error", ...(action ? { action, persistent: true } : { duration: PLAIN_ERROR_MS }) }
}

export function showFailure(message: string, action?: ToastV2Action): number | undefined {
  return showToastV2(errorToast(message, action))
}

/** A prerequisite is missing: say so, and offer the page that fixes it. */
export function showMissing(message: string, action: ErrorAction): number | undefined {
  return showFailure(message, { label: ACTIONS[action].label, onClick: ACTIONS[action].run })
}

export function showKikoError(error: KikoError): number | undefined {
  return error.action ? showMissing(error.message, error.action) : showFailure(error.message)
}

/** A chat's own error is a line in its transcript. The human has seen it there when that chat is open and the tab is showing. */
export const seenInChat = (roomId: string | undefined, openChat: string | null, tabVisible: boolean): boolean => roomId !== undefined && roomId === openChat && tabVisible
