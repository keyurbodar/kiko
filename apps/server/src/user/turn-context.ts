import type { AuthContext, AuthResult, CredentialStore, Provider } from "@earendil-works/pi-ai"
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"
import { createModels, isModelType, ModelsError } from "@earendil-works/pi-ai/models"
import type { ProviderProblem } from "@kiko/protocol"
import { findProvider, overlayFor, overlayRevision, type WireModel } from "../models/catalog"
import { classifyAuthFailure } from "./provider-health"

// Worker bundles cannot follow pi-ai's computed import() for OAuth refresh, so register the bundled flows explicitly.
registerBunOAuthFlows()

export const DEFAULT_TIMEZONE = "UTC"

export type TurnContext = {
  provider: string
  auth: AuthResult | null
  /** The kind of credential the provider holds, when it has one. */
  credential?: "api_key" | "oauth"
  /** Why there is no auth: the sign-in is gone, or the sign-in service could not be reached (the credential is left alone). */
  authProblem?: "signed_out" | "unreachable"
  /** The problem stored for this provider when the turn began. A run that ends well clears it. */
  problem?: ProviderProblem
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

/** The vault's side of provider health: what is stored, and a way to note that a sign-in is gone. */
export type ProblemStore = CredentialStore & {
  problem(provider: string): ProviderProblem | undefined
  setProblem(provider: string, problem: ProviderProblem | null): boolean
}

export type AuthOutcome = Pick<TurnContext, "auth" | "credential" | "authProblem">

/**
 * Resolves a provider's auth, refreshing an OAuth token that is near its end (`minOAuthValidityMs` widens near).
 * A definitive refusal of the refresh marks the provider signed out; any other failure leaves the credential alone.
 */
export async function resolveAuth(store: ProblemStore, found: Provider, minOAuthValidityMs?: number): Promise<AuthOutcome> {
  const models = createModels({ credentials: store, authContext: NO_AMBIENT })
  models.setProvider(found)
  try {
    const auth = (await models.getAuth(found.id, minOAuthValidityMs === undefined ? undefined : { minOAuthValidityMs })) ?? null
    return auth ? { auth, credential: auth.source === "OAuth" ? "oauth" : "api_key" } : { auth }
  } catch (error) {
    console.error(`turn auth failed for ${found.id}: ${error instanceof Error ? error.name : "error"}`)
    if (!(error instanceof ModelsError) || error.code !== "oauth") return { auth: null }
    const verdict = classifyAuthFailure(error.message)
    if (verdict === "fresh") return resolveAuth(store, found)
    if (verdict === "signed_out") store.setProblem(found.id, "signed_out")
    return { auth: null, credential: "oauth", authProblem: verdict }
  }
}

export async function resolveTurnContext(
  store: ProblemStore,
  provider: string,
  settings: { timezone: string | null; captures: boolean },
  agent?: TurnContext["agent"],
  found: Provider | undefined = findProvider(provider),
): Promise<TurnContext> {
  const base = { provider, timezone: settings.timezone ?? DEFAULT_TIMEZONE, captures: settings.captures, catalog: { revision: overlayRevision(), models: overlayFor(provider) }, ...(agent ? { agent } : {}) }
  if (!found) return { ...base, auth: null }
  const outcome = await resolveAuth(store, found)
  const problem = store.problem(provider)
  return { ...base, ...outcome, ...(problem ? { problem } : {}) }
}
