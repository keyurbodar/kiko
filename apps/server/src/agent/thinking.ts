import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai/models"
import { defaultThinking, type ThinkingLevel } from "@kiko/protocol"
import { findProvider } from "../user/turn-context"

function lookup(ref: { provider: string; modelId: string }) {
  return findProvider(ref.provider)?.getModels().find((m) => m.id === ref.modelId)
}

/** The reasoning levels pi-ai says the model supports, or only "off" for a model it does not know. */
export function supportedThinking(ref: { provider: string; modelId: string }): ThinkingLevel[] {
  const model = lookup(ref)
  return model ? getSupportedThinkingLevels(model) : ["off"]
}

/** The level a model runs at: the wanted one clamped to what the model supports, else its default. */
export function thinkingFor(ref: { provider: string; modelId: string }, wanted?: ThinkingLevel): ThinkingLevel {
  const model = lookup(ref)
  if (!model) return "off"
  return wanted ? clampThinkingLevel(model, wanted) : defaultThinking(getSupportedThinkingLevels(model))
}
