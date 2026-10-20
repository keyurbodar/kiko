import type { CatalogProvider } from "./catalog"

export const JUDGE_NOTE = "Sharper memory judgments. Optional."

export const isJudgeOnly = (provider: CatalogProvider) => provider.classifiers > 0 && provider.models.length === 0

export function modelProviders<T extends { chat?: boolean }>(saved: readonly T[]): T[] {
  return saved.filter((p) => p.chat !== false)
}

export const hasModelProvider = (saved: readonly { chat?: boolean }[]) => modelProviders(saved).length > 0
