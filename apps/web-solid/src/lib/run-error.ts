import type { RoomToClient } from "@kiko/protocol"
import { loadCatalog } from "../settings/catalog"
import { showToastV2, type ToastV2Options } from "@kiko/ui/v2/toast-v2"

/** A model error is the reason a reply never came, so it outlasts the default toast. */
const RUN_ERROR_TOAST_MS = 15_000

export type RunErrorFrame = Extract<RoomToClient, { t: "run_error" }>

let go: (href: string) => void = () => {}
export const openSettings = () => go("/settings/models")
/** The shell gives the toast actions a way to navigate. */
export const setGo = (fn: (href: string) => void) => {
  go = fn
}

/** The words for a run that ended in a model or provider error. A pure table: the kind picks the sentence and whether to offer settings. */
export function runErrorToast(frame: Pick<RunErrorFrame, "kind" | "provider" | "detail">, name: string, providerName?: string): ToastV2Options & { title: string; settings?: boolean } {
  const provider = providerName ?? (frame.provider ? frame.provider.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") : "The provider")
  switch (frame.kind) {
    case "no_key":
      return { title: `${name} cannot answer yet`, description: `${provider} is not connected.`, settings: true }
    case "invalid_key":
      return { title: `${provider} did not accept the request`, description: "Check the key and the billing, then send again.", settings: true }
    case "rate_limit":
      return { title: `${provider} is rate limiting requests`, description: "Wait a moment, then send again." }
    case "provider_down":
      return { title: `${provider} is having trouble`, description: "It did not answer. Try again in a bit." }
    case "refused":
      return { title: `The model refused that request`, description: `${name} could not answer it. Rephrase and send again.` }
    case "too_long":
      return { title: "This chat is too long for the model", description: "Pick a model with a larger context, or start a new chat." }
    case "other":
      return { title: `${name} hit an error`, ...(frame.detail ? { description: frame.detail } : {}) }
  }
}

/** The provider's own display name from the catalog ("OpenCode Go"), or undefined when the catalog is not available. */
const catalogName = (id: string | undefined) =>
  id ? loadCatalog().then((catalog) => catalog.providers.find((p) => p.id === id)?.name).catch(() => undefined) : Promise.resolve(undefined)

/** The composer's inline hint already says it, so a no-key run error adds no toast over the first bubble. */
export const hintCoversRunError = (frame: RunErrorFrame, noKey: boolean): boolean => frame.kind === "no_key" && noKey

export async function showRunError(frame: RunErrorFrame, name: string): Promise<void> {
  const { settings, ...toast } = runErrorToast(frame, name, await catalogName(frame.provider))
  showToastV2({
    ...toast,
    variant: "error",
    duration: RUN_ERROR_TOAST_MS,
    ...(settings ? { action: { label: "Open settings", onClick: openSettings } } : {}),
  })
}
