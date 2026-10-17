import type { ProviderProblem } from "@kiko/protocol"
import { modelProviders } from "./provider-kinds"

/** What the human can do about a send that cannot go yet. */
export type BlockAction = "open_settings" | "choose_model"

export type SendBlock = { reason: string; actions: readonly BlockAction[] }

type Saved = { provider: string; problem?: ProviderProblem; chat?: boolean }

/**
 * Why a message to `agent` cannot be sent yet, or null when it can. A message sent in this state
 * would only come back as an error, so the composer keeps the words and disables Send with this
 * reason. `known` is false until the saved providers and the agent's model have loaded: an unknown
 * state never blocks, because the server still answers for itself.
 */
export function sendBlock(input: { known: boolean; providers: readonly Saved[]; model: string | undefined; agent: string | undefined }): SendBlock | null {
  const { providers, model, agent } = input
  if (!input.known || !agent) return null
  const usable = modelProviders(providers)
  if (usable.length === 0) return { reason: "Connect a model provider to chat.", actions: ["open_settings"] }
  if (!model) return { reason: `Choose a model for ${agent}.`, actions: ["choose_model"] }
  const saved = usable.find((p) => p.provider === model.slice(0, model.indexOf("/")))
  if (!saved) return { reason: `${agent}'s model needs a provider you have not connected.`, actions: ["choose_model", "open_settings"] }
  if (saved.problem === "key_refused") return { reason: `${agent}'s provider did not accept your key.`, actions: ["open_settings", "choose_model"] }
  return null
}
