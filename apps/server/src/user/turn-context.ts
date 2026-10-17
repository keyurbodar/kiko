import type { AuthContext, AuthResult, CredentialStore } from "@earendil-works/pi-ai"
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"
import { createModels, isModelType } from "@earendil-works/pi-ai/models"
import { findProvider, overlayFor, overlayRevision, type WireModel } from "../models/catalog"

// Worker bundles cannot follow pi-ai's computed import() for OAuth refresh, so register the bundled flows explicitly.
registerBunOAuthFlows()

export const DEFAULT_TIMEZONE = "UTC"

export type TurnContext = {
  provider: string
  auth: AuthResult | null
  timezone: string
  captures: boolean
  catalog: { revision: string; models: WireModel[] }
  agent?: { soul: { body: string; sha: string; at: number } }
}

const NO_AMBIENT: AuthContext = { env: async () => undefined, fileExists: async () => false }

export function providerUses(id: string): { chat: boolean; judge: boolean } {
  const found = findProvider(id)
  return { chat: (found?.getModels().length ?? 0) > 0, judge: (found?.getAllModels?.() ?? []).some((m) => isModelType(m, "classifier")) }
}

export function pickJudge<T extends { provider: string }>(connected: readonly T[], refused: (p: T) => boolean): T | null {
  return connected.find((p) => !refused(p) && providerUses(p.provider).judge && !providerUses(p.provider).chat) ?? null
}

export async function resolveTurnContext(
  store: CredentialStore,
  provider: string,
  settings: { timezone: string | null; captures: boolean },
  agent?: TurnContext["agent"],
): Promise<TurnContext> {
  const base = { provider, timezone: settings.timezone ?? DEFAULT_TIMEZONE, captures: settings.captures, catalog: { revision: overlayRevision(), models: overlayFor(provider) }, ...(agent ? { agent } : {}) }
  const found = findProvider(provider)
  if (!found) return { ...base, auth: null }
  const models = createModels({ credentials: store, authContext: NO_AMBIENT })
  models.setProvider(found)
  try {
    return { ...base, auth: (await models.getAuth(provider)) ?? null }
  } catch (error) {
    console.error(`turn auth failed for ${provider}: ${error instanceof Error ? error.name : "error"}`)
    return { ...base, auth: null }
  }
}
