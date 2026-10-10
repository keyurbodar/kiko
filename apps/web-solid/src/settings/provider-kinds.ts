import type { CatalogProvider } from "./catalog"

// TypeSafe (Jev) is a key the memory uses for sharper judgments. It sits in the providers list
// but runs no chat model, so nothing that asks "can an agent reply?" may count it.
export const TYPESAFE_ID = "typesafe"
export const TYPESAFE_NOTE = "Sharper memory judgments. Optional."
export const TYPESAFE_PROVIDER: CatalogProvider = { id: TYPESAFE_ID, name: "TypeSafe (Jev)", connect: ["api_key"], models: [] }

/** The saved providers that can run a model. The one rule behind every "is anything connected" check. */
export function modelProviders<T extends { provider: string }>(saved: readonly T[]): T[] {
  return saved.filter((p) => p.provider !== TYPESAFE_ID)
}

export const hasModelProvider = (saved: readonly { provider: string }[]) => modelProviders(saved).length > 0
