import { keyringFromEnv } from "@kiko/durable/crypto"
import type { UpdateStage, UpdateState, UserToClient } from "@kiko/protocol"
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

  constructor(
    private readonly deps: {
      env: Env
      sql: SqlStorage
      userId: () => string
      broadcast: (frame: UserToClient) => void
      waitUntil: (work: Promise<unknown>) => void
    },
  ) {}

  state(): UpdateState {
    return this.#state
  }

  start(version: string): UpdateState {
    if (this.#running()) {
      this.#announce()
      return this.#state
    }
    this.#set({ stage: "uploading", to: version }, "checking")
    this.deps.waitUntil(this.#run(version))
    return this.#state
  }

  #running(): boolean {
    const { stage } = this.#state
    return stage === "uploading" || (stage === "restarting" && Date.now() - this.#restartedAt < RESTART_GRACE_MS)
  }

  async #run(version: string): Promise<void> {
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
            step: (step) => this.deps.broadcast({ t: "update.state", stage: step }),
          },
          version,
        ),
      ),
    )
    if (Exit.isSuccess(exit)) {
      this.#restartedAt = Date.now()
      return this.#set({ stage: "restarting", to: version }, "restarting")
    }
    const failure = Cause.squash(exit.cause)
    const failed =
      failure instanceof UpdateFailed
        ? failure
        : new UpdateFailed({ code: "cloudflare_error", message: "The update failed. Try again." })
    if (!(failure instanceof UpdateFailed)) console.error(`update failed: ${String(failure)}`)
    this.#set({ stage: "failed", to: version, error: failed.code, message: failed.message }, "failed")
  }

  #set(next: UpdateState, stage: UpdateStage): void {
    this.#state = next
    this.#announce(stage)
  }

  #announce(stage?: UpdateStage): void {
    const state = this.#state
    if (state.stage === "idle") return
    this.deps.broadcast({
      t: "update.state",
      stage: stage ?? state.stage,
      ...(state.stage === "failed" ? { error: state.message } : {}),
    })
  }
}
