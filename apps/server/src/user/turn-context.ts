import type { AuthContext, AuthResult, CredentialStore, Provider } from "@earendil-works/pi-ai"
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"
import { createModels } from "@earendil-works/pi-ai/models"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"

// Architecture section 11.3. At the start of a run, `AgentDO` calls `UserDO.turnContext(provider)`
// once. The answer carries the request auth for that one provider, already refreshed when it is an
// OAuth token, plus the user's timezone and limits. The agent keeps the auth in memory for that run
// only. Nothing here logs a credential, and the Worker's HTTP layer never sees this answer.

// pi-ai loads OAuth refresh code through a computed `import()` that a Worker bundle cannot follow.
// `provider-login.ts` registers the bundled flows too. Registering twice fills the same table.
registerBunOAuthFlows()

/** Architecture section 7.7. ASSUMPTION: the default numbers, until a plan changes the record. */
export type Limits = {
  hops: number
  deliveriesPerRoot: number
  membersPerRoom: number
  autonomousRunsPerDay: number
}

export const DEFAULT_LIMITS: Limits = { hops: 8, deliveriesPerRoot: 40, membersPerRoom: 8, autonomousRunsPerDay: 50 }

/** ASSUMPTION: a user who never set a timezone is on UTC. */
export const DEFAULT_TIMEZONE = "UTC"

export type TurnContext = {
  provider: string
  /** Null when the user has no usable credential for `provider`. The run must not start. */
  auth: AuthResult | null
  timezone: string
  limits: Limits
  /** The memory records read on every run (section 13.2). The profile goes into the system prompt. */
  profile: string
  /** `now` and `todo` go into the input's `<context>` block, because they change more often. */
  now: string
  todo: string
}

/** The bodies of the three memory records every run reads. */
export type TurnMemory = Pick<TurnContext, "profile" | "now" | "todo">

/** Credentials come from the vault only. A run never reads the Worker's environment or files. */
const NO_AMBIENT: AuthContext = { env: async () => undefined, fileExists: async () => false }

let providers: Map<string, Provider> | undefined

/**
 * pi-ai's provider with this id, or undefined. Kiko adds no provider of its own. A provider holds
 * no credential (a `Models` resolves auth per request), so one isolate shares one set.
 */
export function findProvider(id: string): Provider | undefined {
  providers ??= new Map(builtinProviders().map((p) => [p.id, p]))
  return providers.get(id)
}

/**
 * Resolves the request auth for `provider` from the user's vault. pi-ai refreshes an OAuth token
 * that expires within five minutes and writes the new token back through the vault, all inside
 * `UserDO`. A failed refresh or an unknown provider is the same as no credential: the chat shows
 * the connect prompt.
 */
export async function resolveTurnContext(
  store: CredentialStore,
  provider: string,
  settings: { timezone: string | null; limits: Partial<Limits> | null },
  memory: TurnMemory,
): Promise<TurnContext> {
  const base = { provider, timezone: settings.timezone ?? DEFAULT_TIMEZONE, limits: { ...DEFAULT_LIMITS, ...settings.limits }, ...memory }
  const found = findProvider(provider)
  if (!found) return { ...base, auth: null }
  const models = createModels({ credentials: store, authContext: NO_AMBIENT })
  models.setProvider(found)
  try {
    return { ...base, auth: (await models.getAuth(provider)) ?? null }
  } catch (error) {
    // Only the error's class: a provider message could echo a token.
    console.error(`turn auth failed for ${provider}: ${error instanceof Error ? error.name : "error"}`)
    return { ...base, auth: null }
  }
}
