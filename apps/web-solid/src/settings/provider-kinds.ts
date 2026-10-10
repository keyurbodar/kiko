import type { CatalogProvider } from "./catalog"

export const JUDGE_NOTE = "Sharper memory judgments. Optional."

/** A provider with classifier models and no chat models: its key sharpens memory and runs no agent. */
export const isJudgeOnly = (provider: CatalogProvider) => provider.classifiers > 0 && provider.models.length === 0

/** The saved providers that can run a model. The one rule behind every "is anything connected" check. */
export function modelProviders<T extends { chat?: boolean }>(saved: readonly T[]): T[] {
  return saved.filter((p) => p.chat !== false)
}

export const hasModelProvider = (saved: readonly { chat?: boolean }[]) => modelProviders(saved).length > 0
