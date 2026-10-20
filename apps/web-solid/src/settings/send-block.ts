import type { ProviderProblem } from "@kiko/protocol"
import { modelProviders } from "./provider-kinds"

export type BlockAction = "open_settings" | "choose_model"

export type SendBlock = { reason: string; actions: readonly BlockAction[] }

type Saved = { provider: string; problem?: ProviderProblem; chat?: boolean }

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
