import type { OwnerServices } from "../owner/services"
import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import { keyringFromEnv } from "@kiko/durable/crypto"
import {
  isAgentSlug,
  isRoomId,
  type BrowserState,
  type KernelResult,
  type KernelStatus,
  type NoticeError,
  type UserToClient,
} from "@kiko/protocol"
import type { Env } from "../index"
import { type KernelClient, KernelError, REJECTED, sdkClient } from "../integrations/kernel/client"
import {
  browserState,
  checkAgentId,
  checkTabs,
  kernelErrorText,
  profileName,
  WATCH_MS,
} from "../integrations/kernel/connect"
import { humanHolds, KernelLease, type LeaseInfo, REAP_WAKEUP } from "../integrations/kernel/lease"
import { KernelStore } from "../integrations/kernel/store"
import * as Effect from "effect/Effect"
import { kernelFailure, kernelIntegrationError } from "./user-errors"
import { checkApiKey } from "./credentials"
import { type Attachment, send, trySend } from "./socket-frames"

export type LiveLinkResult = { ok: true; url: string; posted: boolean } | { ok: false; error: string }

export type BrowserCheck = {
  connected: boolean
  takeover: boolean
  mode: "headless" | "headful" | null
  tabs: Record<string, number>
  list: { id: string; agent: string; url: string }[]
}

type KernelDeps = {
  fetch?: typeof fetch
  ctx: DurableObjectState
  sql: SqlStorage
  env: Env
  services: OwnerServices
  alarms: Alarms
  userId: () => string
  notify?: (error: NoticeError) => void
  store?: KernelStore
  clientFor?: (key: string) => KernelClient
}

const RESUMED = {
  released: "The human released control of the browser: it is yours again.",
  expired: "The human's control of the browser timed out after 30 minutes: it is yours again.",
} as const
const RESUME =
  " Carry on with the browser work that was waiting. Tell the worker that was waiting to continue with tell_work; its tabs are still open where the human left them, so it must not load the page again. Say one short line to the human only if there is something to say."

function slugOf(agentId: string): string {
  return agentId.split(/[/:]/).pop() ?? agentId
}

export class KernelWiring {
  readonly browser: KernelLease
  private switching = false
  private sent = ""
  private readonly d: KernelDeps
  private readonly store: KernelStore
  private readonly clientFor: (key: string) => KernelClient

  constructor(d: KernelDeps) {
    this.d = d
    this.store = d.store ?? new KernelStore(d.sql, () => ({ keyring: keyringFromEnv(d.env), userId: d.userId() }))
    this.clientFor = d.clientFor ?? ((key) => sdkClient(key, d.fetch))
    this.browser = new KernelLease({
      store: this.store,
      client: () => this.client(),
      profile: () => profileName(d.userId()),
      wake: { set: (at) => d.alarms.setWakeup(REAP_WAKEUP, at), clear: () => d.alarms.clearWakeup(REAP_WAKEUP) },
    })
  }

  status(): KernelStatus {
    const connected = this.store.connected()
    return { connected, broken: connected && this.store.broken(), browser: connected ? this.browser.status() : null }
  }

  async connect(apiKey: unknown): Promise<KernelStatus> {
    const key = checkApiKey(apiKey)
    try {
      await this.clientFor(key).listActive()
    } catch (e) {
      if (e instanceof KernelError && e.kind === "unauthorized")
        throw new KernelError({ kind: "unauthorized", message: REJECTED })
      throw e
    }
    await this.closeBrowser()
    this.store.clear()
    await this.store.putKey(key, this.store.generation)
    return this.status()
  }

  async disconnect(): Promise<void> {
    await this.closeBrowser()
    this.store.clear()
    await this.d.alarms.clearWakeup(REAP_WAKEUP)
  }

  async lease(agentId: string): Promise<LeaseInfo> {
    const info = await this.browser.lease(checkAgentId(agentId)).catch((e) => {
      const error = kernelFailure(e)
      if (error) this.d.notify?.(error)
      throw e
    })
    this.push()
    return info
  }

  touch(agentId: string, tabs?: Record<string, string>): boolean {
    const known = this.browser.touch(checkAgentId(agentId), checkTabs(tabs))
    this.push()
    return known
  }

  async liveLink(agentId: string, roomId: string, mode: "watch" | "control", reason?: string): Promise<LiveLinkResult> {
    checkAgentId(agentId)
    const slug = slugOf(agentId)
    if (!isRoomId(roomId) || !isAgentSlug(slug)) return { ok: false, error: "Unknown room or agent" }
    let url: string
    try {
      url = await this.link(mode)
    } catch (e) {
      return { ok: false, error: kernelErrorText(e) }
    } finally {
      this.push()
    }
    if (mode === "control") this.join(agentId, roomId)
    const why = typeof reason === "string" ? reason.trim().slice(0, 300) : ""
    if (!why) return { ok: true, url, posted: false }
    const room = this.d.services.room(roomId)
    const posted =
      mode === "control"
        ? await room.browserAsk(slug, why, `${this.store.control()?.at ?? Date.now()}`)
        : await room.browserShare(slug, `${why} [Watch the browser](${url})`)
    return { ok: true, url, posted }
  }

  tabList(agentId: string): { id: string; agent: string; url: string }[] {
    const row = this.store.connected() ? this.store.lease() : undefined
    if (!row || row.dead) return []
    return Object.entries(row.tabs).flatMap(([owner, tabs]) =>
      Object.entries(tabs).map(([id, url]) => ({
        id,
        agent: owner,
        url: owner === agentId ? url : url.replace(/[?#].*$/, ""),
      })),
    )
  }

  async dead(agentId: string, sessionId: string): Promise<boolean> {
    checkAgentId(agentId)
    if (typeof sessionId !== "string" || !sessionId) return false
    const dead = await this.browser.dead(sessionId)
    if (dead) this.push()
    return dead
  }

  async reap(): Promise<void> {
    await this.browser.reap()
    if (!this.takeover() && this.store.control()) this.resume("expired")
    this.push()
  }

  handBack(by?: string): boolean {
    const row = this.store.lease()
    const held = row !== undefined && humanHolds(row, Date.now())
    if (row) this.browser.setTakeover(false)
    if (this.store.control()) this.resume("released", by)
    this.push()
    return held
  }

  private join(agentId?: string, roomId?: string): void {
    const now = this.store.control() ?? { at: Date.now(), waiters: [] }
    if (agentId && roomId && !now.waiters.some((w) => w.agentId === agentId)) now.waiters.push({ agentId, roomId })
    this.store.setControl(now)
  }

  private resume(why: keyof typeof RESUMED, except?: string): void {
    const control = this.store.control()
    this.store.setControl(undefined)
    for (const { agentId, roomId } of control?.waiters ?? []) {
      const slug = slugOf(agentId)
      if (agentId === except || !isRoomId(roomId) || !isAgentSlug(slug)) continue
      const wake = this.d.services.room(roomId).wake({
        id: `browser-back:${control?.at}:${slug}`,
        to: slug,
        why: "system",
        body: `${RESUMED[why]}${RESUME}`,
        chain: null,
      })
      this.d.ctx.waitUntil(
        Promise.resolve(wake).catch((e) =>
          console.error(`browser resume wake failed: ${e instanceof Error ? e.message : String(e)}`),
        ),
      )
    }
  }

  paused(agentId: string, roomId: string): boolean {
    const held = this.takeover()
    if (held) this.join(checkAgentId(agentId), roomId)
    return held
  }

  check(agentId?: string): BrowserCheck {
    const status = this.browser.status()
    return {
      connected: this.store.connected(),
      takeover: this.takeover(),
      mode: status?.mode ?? null,
      tabs: status?.tabs ?? {},
      list: this.tabList(agentId ?? ""),
    }
  }

  takeover(): boolean {
    const row = this.store.lease()
    return row !== undefined && humanHolds(row, Date.now())
  }

  browserState(): BrowserState {
    const row = this.store.connected() ? this.store.lease() : undefined
    return browserState(row && { ...row, takeover: humanHolds(row, Date.now()) }, this.switching, (agentId) => {
      const slug = slugOf(agentId)
      const row = this.d.sql.exec<{ name: string }>("SELECT name FROM agents WHERE slug = ?", slug).toArray()[0]
      return { slug, name: row?.name ?? slug }
    })
  }

  private async openLink(mode: "watch" | "control", onSwitching: (on: boolean) => void): Promise<string> {
    if (!this.store.connected()) throw new KernelError({ kind: "failed", message: "Kernel is not connected" })
    const hold = () =>
      mode === "control" ? this.browser.setTakeover(true) : this.browser.watchUntil(Date.now() + WATCH_MS)
    const row = this.store.lease()
    if (!row || row.dead || row.mode === "headless") {
      onSwitching(true)
      try {
        await this.browser.switchMode("headful")
      } finally {
        onSwitching(false)
      }
    }
    hold()
    const live = (await this.store.urls())?.liveUrl
    if (!live) throw new KernelError({ kind: "failed", message: "Kernel gave no live view for this browser" })
    if (mode === "control") return live
    const url = new URL(live)
    url.searchParams.set("readOnly", "true")
    return url.toString()
  }

  private link(mode: "watch" | "control"): Promise<string> {
    return this.openLink(mode, (on) => {
      this.switching = on
      this.push()
    })
  }

  sessionId(): string | null {
    return this.store.lease()?.sessionId ?? null
  }

  age(ms: number): void {
    const row = this.store.lease()
    if (row)
      this.store.patchLease({
        lastUse: row.lastUse - ms,
        ...(row.watchUntil ? { watchUntil: Math.max(1, row.watchUntil - ms) } : {}),
      })
  }

  private async closeBrowser(): Promise<void> {
    if (!this.store.connected()) return
    await this.browser.close().catch(() => undefined)
  }

  private async client(): Promise<KernelClient> {
    const key = await this.store.key()
    if (!key) throw new KernelError({ kind: "failed", message: "Kernel is not connected" })
    return this.clientFor(key)
  }

  push(): void {
    const text = JSON.stringify({ t: "browserState", state: this.browserState() } satisfies UserToClient)
    if (text === this.sent) return
    this.sent = text
    for (const ws of this.d.ctx.getWebSockets("tab")) {
      if ((ws.deserializeAttachment() as Attachment | null)?.ready) trySend(ws, text)
    }
  }

  readonly browserLink = Effect.fn("Kernel.browserLink")({ self: this }, function* (mode: "watch" | "control") {
    const url = yield* Effect.tryPromise({ try: () => this.link(mode), catch: kernelIntegrationError })
    if (mode === "control") this.join()
    this.push()
    return { ok: true as const, url }
  })

  readonly browserHandBack = Effect.fn("Kernel.browserHandBack")({ self: this }, function () {
    return Effect.sync(() => {
      this.handBack()
      this.push()
    })
  })

  readonly browserClose = Effect.fn("Kernel.browserClose")({ self: this }, function* () {
    yield* Effect.promise(() =>
      this.browser.close().catch((e) => console.error(`close browser failed: ${kernelErrorText(e)}`)),
    )
    if (this.store.control()) this.resume("released")
    this.push()
  })

  readonly kernelConnect = Effect.fn("Kernel.connect")({ self: this }, function* (apiKey: string) {
    const status = yield* Effect.tryPromise({ try: () => this.connect(apiKey), catch: kernelIntegrationError })
    return this.announce({ ok: true, status })
  })

  readonly kernelDisconnect = Effect.fn("Kernel.disconnect")({ self: this }, function* () {
    yield* Effect.tryPromise({ try: () => this.disconnect(), catch: kernelIntegrationError })
    return this.announce({ ok: true, status: this.status() })
  })

  readonly kernelStatus = Effect.fn("Kernel.status")({ self: this }, function (socket: WebSocket) {
    return Effect.sync((): KernelResult => {
      send(socket, { t: "browserState", state: this.browserState() })
      this.push()
      return { ok: true, status: this.status() }
    })
  })

  private announce(result: KernelResult): KernelResult {
    this.push()
    const text = JSON.stringify({ t: "kernel", result } satisfies UserToClient)
    for (const tab of this.d.ctx.getWebSockets("tab"))
      if ((tab.deserializeAttachment() as Attachment | null)?.ready) trySend(tab, text)
    return result
  }
}
