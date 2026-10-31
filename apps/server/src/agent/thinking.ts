import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai/models"
import { defaultThinking, type ThinkingLevel } from "@kiko/protocol"
import { findProvider } from "../models/catalog"

export function parseModelRef(ref: string): { provider: string; modelId: string } | null {
  const at = ref.indexOf("/")
  return at > 0 ? { provider: ref.slice(0, at), modelId: ref.slice(at + 1) } : null
}

export function isKnownModel(ref: { provider: string; modelId: string }): boolean {
  return lookup(ref) !== undefined
}

function lookup(ref: { provider: string; modelId: string }) {
  return findProvider(ref.provider)
    ?.getModels()
    .find((m) => m.id === ref.modelId)
}

export function modelName(ref: { provider: string; modelId: string } | null, fallback: string): string
export function modelName(ref: { provider: string; modelId: string } | null): string | undefined
export function modelName(ref: { provider: string; modelId: string } | null, fallback?: string): string | undefined {
  const model = ref ? lookup(ref) : undefined
  return model?.name.replace(/\s*\(latest\)$/i, "") ?? fallback
}

export function supportedThinking(ref: { provider: string; modelId: string }): ThinkingLevel[] {
  const model = lookup(ref)
  return model ? getSupportedThinkingLevels(model) : ["off"]
}

export function thinkingFor(ref: { provider: string; modelId: string }, wanted?: ThinkingLevel): ThinkingLevel {
  const model = lookup(ref)
  if (!model) return "off"
  return wanted ? clampThinkingLevel(model, wanted) : defaultThinking(getSupportedThinkingLevels(model))
}
