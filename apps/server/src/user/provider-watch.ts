import type { Provider } from "@earendil-works/pi-ai"
import type { Alarms } from "@kiko/durable/alarm"
import type { ProviderInfo } from "@kiko/protocol"
import { userModels } from "../agent/factory"
import type { CredentialVault } from "./credentials"
import { providerSaid } from "./credentials-check"
import { probeVerdict } from "./provider-health"
import { resolveAuth } from "./turn-context"

export const PROVIDERS_WAKEUP = "providers"
const PROVIDERS_INTERVAL_MS = 6 * 60 * 60 * 1000
// A touch more than the interval, so a token that would end before the next wake is refreshed now.
const PROBE_VALIDITY_MS = 6.5 * 60 * 60 * 1000

type Deps = {
  vault: () => CredentialVault
  alarms: Alarms
  sql: SqlStorage
  now: () => number
  lookup: (provider: string) => Promise<Provider | undefined>
  label: string
}

/**
 * Notices a provider that stopped working without waiting for a run: a sign-in that expired or was revoked is found
 * by refreshing tokens every six hours, and "check again" probes one provider on demand.
 */
export class ProviderWatch {
  constructor(private readonly d: Deps) {}

  async init(): Promise<void> {
    const armed = this.d.sql.exec("SELECT 1 FROM wakeups WHERE key = ?", PROVIDERS_WAKEUP).toArray().length > 0
    if (!armed) await this.d.alarms.setWakeup(PROVIDERS_WAKEUP, this.d.now() + PROVIDERS_INTERVAL_MS)
  }

  async wake(): Promise<void> {
    await this.d.alarms.setWakeup(PROVIDERS_WAKEUP, this.d.now() + PROVIDERS_INTERVAL_MS)
    await this.refreshAll()
  }

  /** One refresh per OAuth provider, so the subrequests stay far below the limit. */
  async refreshAll(): Promise<void> {
    for (const info of this.d.vault().listProviders()) {
      if (info.kind !== "oauth") continue
      const found = await this.d.lookup(info.provider)
      if (found) await resolveAuth(this.d.vault(), found, PROBE_VALIDITY_MS)
    }
  }

  /** Sends the cheapest request with the stored credential, then sets or clears the provider's problem. */
  async check(provider: string): Promise<ProviderInfo | null> {
    const info = this.d.vault().listProviders().find((p) => p.provider === provider)
    const found = info ? await this.d.lookup(provider) : undefined
    if (!info || !found) return info ?? null
    const outcome = await resolveAuth(this.d.vault(), found, info.kind === "oauth" ? PROBE_VALIDITY_MS : undefined)
    const auth = outcome.auth
    if (auth) {
      const { models, settings } = userModels(async () => auth, `check-${this.d.label}`)
      const verdict = probeVerdict(await providerSaid(models, provider, settings.stream?.headers), info.kind)
      if (verdict !== "keep") this.d.vault().setProblem(provider, verdict)
    }
    return this.d.vault().listProviders().find((p) => p.provider === provider) ?? null
  }
}
