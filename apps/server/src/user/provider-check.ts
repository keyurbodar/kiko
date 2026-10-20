import type { Provider } from "@earendil-works/pi-ai"
import type { ProviderInfo } from "@kiko/protocol"
import { userModels } from "../agent/factory"
import type { CredentialVault } from "./credentials"
import { providerSaid } from "./credentials-check"
import { probeVerdict } from "./provider-health"
import { resolveAuth } from "./turn-context"

const PROBE_VALIDITY_MS = 6.5 * 60 * 60 * 1000

type Deps = {
  vault: () => CredentialVault
  lookup: (provider: string) => Promise<Provider | undefined>
  label: string
}

export class ProviderCheck {
  constructor(private readonly d: Deps) {}

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
