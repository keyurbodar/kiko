import type { AuthContext, AuthResult, CredentialStore, Provider } from "@earendil-works/pi-ai"
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"
import { createModels, isModelType, ModelsError } from "@earendil-works/pi-ai/models"
import type { ProviderProblem } from "@kiko/protocol"
import { findProvider, overlayFor, overlayRevision, type WireModel } from "../models/catalog"
import { classifyAuthFailure } from "./provider-health"

registerBunOAuthFlows()

export const DEFAULT_TIMEZONE = "UTC"

export type TurnContext = {
  provider: string
  auth: AuthResult | null
  credential?: "api_key" | "oauth"
  authProblem?: "signed_out" | "unreachable"
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

type ProblemStore = CredentialStore & {
  problem(provider: string): ProviderProblem | undefined
  setProblem(provider: string, problem: ProviderProblem | null): boolean
}

type AuthOutcome = Pick<TurnContext, "auth" | "credential" | "authProblem">

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
