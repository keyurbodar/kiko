import type { ProviderProblem } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { openSettings } from "../lib/errors"

export const PROBLEM_LINE: Record<ProviderProblem, string> = {
  signed_out: "Sign-in expired. Sign in again.",
  key_refused: "Key refused. Connect again with a new key.",
  no_credit: "Out of credit. Check the plan or billing, then check again.",
}

export const PROBLEM_SHORT: Record<ProviderProblem, string> = {
  signed_out: "Sign-in expired",
  key_refused: "Key refused",
  no_credit: "Out of credit",
}

export const FIX_LABEL: Record<ProviderProblem, string | null> = {
  signed_out: "Sign in again",
  key_refused: "Replace key",
  no_credit: null,
}

const [target, setTarget] = createSignal<string | null>(null)

export const reconnectTarget = target
export const clearReconnect = () => setTarget(null)

export function reconnect(provider: string): void {
  setTarget(provider)
  openSettings()
}
