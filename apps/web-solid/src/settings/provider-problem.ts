import type { ProviderProblem } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { openSettings } from "../lib/errors"
import { setModelsTab } from "./models-tab"

/** The sentence a provider row shows under its name, and what to do next. */
export const PROBLEM_LINE: Record<ProviderProblem, string> = {
  signed_out: "Sign-in expired. Sign in again.",
  key_refused: "Key refused. Connect again with a new key.",
  no_credit: "Out of credit. Check the plan or billing, then check again.",
}

/** The same problem in a few words, for a picker row. */
export const PROBLEM_SHORT: Record<ProviderProblem, string> = {
  signed_out: "Sign-in expired",
  key_refused: "Key refused",
  no_credit: "Out of credit",
}

/** What the fix button says. A lack of credit is fixed at the provider, so only the check is offered. */
export const FIX_LABEL: Record<ProviderProblem, string | null> = {
  signed_out: "Sign in again",
  key_refused: "Replace key",
  no_credit: null,
}

const [target, setTarget] = createSignal<string | null>(null)

/** The provider whose connect dialog the Models page should open as soon as it can. */
export const reconnectTarget = target
export const clearReconnect = () => setTarget(null)

/** Opens the Providers tab with the connect dialog of one provider. */
export function reconnect(provider: string): void {
  setModelsTab("providers")
  setTarget(provider)
  openSettings()
}
