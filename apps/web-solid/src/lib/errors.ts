import type { ErrorAction, KikoError } from "@kiko/protocol"
import { showToastV2, type ToastV2Action, type ToastV2Options } from "@kiko/ui/v2/toast-v2"

/*
 * The one place an error becomes a toast. The server sends a KikoError (a sentence, an optional
 * action) and every other failure the client sees goes through `showFailure`. A toast with an action
 * stays until dismissed, because the human has something to do. One without goes away on its own.
 * The same toast again refreshes the one on screen, so a repeated failure never stacks.
 */

/** A toast with no action has nothing to wait for, so it closes sooner than a model error and later than a confirmation. */
const PLAIN_ERROR_MS = 10_000

let go: (href: string) => void = () => {}
/** The shell gives the toast actions a way to navigate. */
export const setGo = (fn: (href: string) => void) => {
  go = fn
}
export const openSettings = () => go("/settings/models")
export const openIntegrations = () => go("/settings/tools")

const ACTIONS: Record<ErrorAction, { label: string; run: () => void }> = {
  open_models: { label: "Open settings", run: openSettings },
  open_integrations: { label: "Open settings", run: openIntegrations },
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
