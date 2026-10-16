import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai/models"
import { defaultThinking, type ThinkingLevel } from "@kiko/protocol"
import { findProvider } from "../user/turn-context"

/** `provider/model` as a model reference. A string with no provider names no model. */
export function parseModelRef(ref: string): { provider: string; modelId: string } | null {
  const at = ref.indexOf("/")
  return at > 0 ? { provider: ref.slice(0, at), modelId: ref.slice(at + 1) } : null
}

/** True when pi-ai lists this model, so a stale or made-up id never reaches a run. */
export function isKnownModel(ref: { provider: string; modelId: string }): boolean {
  return lookup(ref) !== undefined
}

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
