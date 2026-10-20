import { type Keyring, keyringFromEnv } from "@kiko/durable/crypto"
import type { UpdateStage, UserToClient } from "@kiko/protocol"
import type { Env } from "../index"
import { devOverride } from "../lib/dev-guard"
import { updateConfig } from "../lib/release-config"
import { getSetting, setSetting } from "../lib/settings"
import { openGrant, parseGrant, runUpdate, sealGrant, type UpdateConfig } from "./update"

const GRANT = "cf_grant"
const DEV_UPDATE = "dev_update"

type Dev = Partial<UpdateConfig> & { grant?: string }

export class UpdateWiring {
  #stage: { stage: UpdateStage; error?: string } | null = null
  #running = false

  constructor(
    private readonly deps: {
      env: Env
      sql: SqlStorage
      userId: () => string
      broadcast: (frame: UserToClient) => void
    },
  ) {}

  #dev(): Dev | null {
    return devOverride(() => {
      const text = getSetting(this.deps.sql, DEV_UPDATE)
      return text ? (JSON.parse(text) as Dev) : null
    })
  }

  async start(version: string): Promise<void> {
    if (this.#running) {
      if (this.#stage) this.deps.broadcast({ t: "update.state", ...this.#stage })
      return
    }
    this.#running = true
    const keyring: Keyring = keyringFromEnv(this.deps.env)
    const dev = this.#dev()
    try {
      await runUpdate(
        {
          fetch: (url, init) => fetch(url, init),
          config: updateConfig(this.deps.env, dev),
          loadGrant: async () => {
            const stored = getSetting(this.deps.sql, GRANT)
            return (stored ? await openGrant(keyring, this.deps.userId(), stored) : null) ?? parseGrant(dev?.grant ?? this.deps.env.CF_GRANT)
          },
          saveGrant: async (grant) => setSetting(this.deps.sql, GRANT, await sealGrant(keyring, this.deps.userId(), grant)),
          report: (stage, error) => {
            this.#stage = { stage, ...(error ? { error } : {}) }
            this.deps.broadcast({ t: "update.state", ...this.#stage })
          },
        },
        version,
      )
    } finally {
      this.#running = false
    }
  }
}
