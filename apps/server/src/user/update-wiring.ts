import { keyringFromEnv } from "@kiko/durable/crypto"
import type { UpdateState } from "@kiko/protocol"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type { Env } from "../index"
import { devOverride } from "../lib/dev-guard"
import { updateConfig } from "../lib/release-config"
import { getSetting, setSetting } from "../lib/settings"
import { grantStore, runUpdate, type UpdateConfig, UpdateFailed } from "./update"

const GRANT = "cf_grant"
const DEV_UPDATE = "dev_update"
const RESTART_GRACE_MS = 60_000

type Dev = Partial<UpdateConfig> & { grant?: string }

export class SelfUpdate {
  #state: UpdateState = { stage: "idle" }
  #restartedAt = 0
  #pending: Promise<UpdateState> | null = null

  constructor(
    private readonly deps: {
      env: Env
      sql: SqlStorage
      userId: () => string
      waitUntil: (work: Promise<unknown>) => void
    },
  ) {}

  state(): UpdateState {
    return this.#state
  }

  start(version: string): Promise<UpdateState> {
    if (this.#running()) return Promise.resolve(this.#state)
    this.#state = { stage: "uploading", to: version }
    const run = this.#run(version)
    this.#pending = run
    this.deps.waitUntil(run)
    return Promise.resolve(this.#state)
  }

  done(): Promise<UpdateState> {
    return this.#pending ?? Promise.resolve(this.#state)
  }

  #running(): boolean {
    const { stage } = this.#state
    return stage === "uploading" || (stage === "restarting" && Date.now() - this.#restartedAt < RESTART_GRACE_MS)
  }

  async #run(version: string): Promise<UpdateState> {
    const dev = devOverride(() => {
      const text = getSetting(this.deps.sql, DEV_UPDATE)
      return text ? (JSON.parse(text) as Dev) : null
    })
    const exit = await Effect.runPromiseExit(
      Effect.suspend(() =>
        runUpdate(
          {
            fetch: (url, init) => fetch(url, init),
            config: updateConfig(this.deps.env, dev),
            grants: grantStore({
              keyring: keyringFromEnv(this.deps.env),
              userId: this.deps.userId(),
              env: dev?.grant ?? this.deps.env.CF_GRANT,
              cell: {
                read: () => getSetting(this.deps.sql, GRANT),
                write: (text) => setSetting(this.deps.sql, GRANT, text),
              },
            }),
          },
          version,
        ),
      ),
    )
    if (Exit.isSuccess(exit)) {
      this.#restartedAt = Date.now()
      this.#state = { stage: "restarting", to: version }
      return this.#state
    }
    const failure = Cause.squash(exit.cause)
    const failed =
      failure instanceof UpdateFailed
        ? failure
        : new UpdateFailed({ code: "cloudflare_error", message: "The update failed. Try again." })
    if (!(failure instanceof UpdateFailed)) console.error(`update failed: ${String(failure)}`)
    this.#state = { stage: "failed", to: version, error: failed.code, message: failed.message }
    return this.#state
  }
}
