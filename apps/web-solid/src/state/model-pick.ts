import { type AgentModel, clampThinking, defaultThinking, type ThinkingLevel } from "@kiko/protocol"

export type ModelPick = {
  ref?: string
  name?: string
  thinking?: ThinkingLevel
  levels?: readonly ThinkingLevel[]
}

export function pickedModel(current: AgentModel | undefined, pick: ModelPick): AgentModel | undefined {
  const levels = pick.levels ?? current?.thinkingLevels
  const model = pick.ref ?? current?.model
  if (!model || !levels) return undefined
  const name = pick.name ?? (model === current?.model ? current?.name : undefined)
  return {
    model,
    ...(name ? { name } : {}),
    thinking: clampThinking(levels, pick.thinking ?? current?.thinking ?? defaultThinking(levels)),
    thinkingLevels: [...levels],
  }
}
