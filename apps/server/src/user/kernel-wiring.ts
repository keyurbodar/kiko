import type { Alarms } from "@kiko/durable/alarm"
import { keyringFromEnv } from "@kiko/durable/crypto"
import { isAgentSlug, isRoomId, type BrowserLinkResult, type BrowserState, type ClientToUser as UserFrame, type KernelResult, type KernelStatus, type KikoError, type UserToClient } from "@kiko/protocol"
import type { Env } from "../index"
import { type CurlRequest, type CurlResponse, type KernelClient, KernelError, REJECTED, sdkClient } from "../integrations/kernel/client"
import { browserState, checkAgentId, checkTabs, kernelErrorText, profileName, UPLOAD_DIR, WATCH_MS } from "../integrations/kernel/connect"
import { FETCH_METHODS, URL_CAP } from "../integrations/kernel/files"
import { humanHolds, KernelLease, type LeaseInfo, REAP_WAKEUP } from "../integrations/kernel/lease"
import { KernelStore } from "../integrations/kernel/store"
import { kernelFailure } from "./user-errors"
import { roomStub } from "../lib/names"
import { checkApiKey } from "./credentials"
import { type Attachment, send, trySend } from "./sockets"

export type LiveLinkResult = { ok: true; url: string; posted: boolean } | { ok: false; error: string }

/** What an agent reads before a browser call. `list` holds every open tab with its owner's agent id. */
export type BrowserCheck = {
  connected: boolean
  takeover: boolean
  mode: "headless" | "headful" | null
  tabs: Record<string, number>
  list: { id: string; agent: string; url: string }[]
}

type KernelDeps = {
  ctx: DurableObjectState
  sql: SqlStorage
  env: Env
  alarms: Alarms
  userId: () => string
  /** Tells the human a browser start failed and why. */
  notify?: (error: KikoError) => void
  /** Tests pass a fake store and Kernel client. */
  store?: KernelStore
  clientFor?: (key: string) => KernelClient
}

/** Kernel's downloads directory and `/tmp`, the only places `getFile` reads. */
const ALLOWED_READ = /^(\/tmp\/|\/home\/kernel\/Downloads\/)/

/** The agent slug at the end of a lease id such as `room/slug`. */
function slugOf(agentId: string): string {
  return agentId.split(/[/:]/).pop() ?? agentId
}

// The user's one Kernel browser, leased to their agents (architecture section 27). The CDP URL
// goes to the agent that asked and nowhere else. The Kernel key never leaves this object.
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
    this.clientFor = d.clientFor ?? sdkClient
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
      if (e instanceof KernelError && e.kind === "unauthorized") throw new KernelError("unauthorized", REJECTED)
      throw e
    }
    // A browser on the old key must not outlive it.
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

  /** The user's browser for `agentId`, headless unless the human asked to watch. Creates it when there is none. */
  async lease(agentId: string): Promise<LeaseInfo> {
    const info = await this.browser.lease(checkAgentId(agentId)).catch((e) => {
      const error = kernelFailure(e)
      if (error) this.d.notify?.(error)
      throw e
    })
    this.push()
    return info
  }

  /** Stamps last use. `tabs` (tab id to last URL) replaces the agent's tabs. False when the browser it knew is gone. */
  touch(agentId: string, tabs?: Record<string, string>): boolean {
    const known = this.browser.touch(checkAgentId(agentId), checkTabs(tabs))
    this.push()
    return known
  }

  /**
   * The live view link, for an agent to hand to the human. `control` pauses every agent's browser tools until the
   * human hands back, so it is the request for a login, a captcha, or a payment. With a `reason` the link is posted
   * to the room as a plain message from the agent: a worker never posts, and it is the worker that hits the login.
   * The link is a bearer capability for the life of the browser; the owner asked for it in the chat (section 27.7).
   * `agentId` ends in the agent's slug (after the last "/" or ":").
   */
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
    const why = typeof reason === "string" ? reason.trim().slice(0, 300) : ""
    if (!why) return { ok: true, url, posted: false }
    const label = mode === "control" ? "Take control" : "Watch the browser"
    const posted = await roomStub(this.d.env.ROOM, this.d.userId(), roomId).browserShare(slug, `${why} [${label}](${url})`)
    return { ok: true, url, posted }
  }

  /** Every open tab with its owner, for an agent to see. Other agents' addresses lose their query and fragment. */
  tabList(agentId: string): { id: string; agent: string; url: string }[] {
    const row = this.store.connected() ? this.store.lease() : undefined
    if (!row || row.dead) return []
    return Object.entries(row.tabs).flatMap(([owner, tabs]) =>
      Object.entries(tabs).map(([id, url]) => ({ id, agent: owner, url: owner === agentId ? url : url.replace(/[?#].*$/, "") })),
    )
  }

  /** The agent's socket died: the next lease makes a new browser. */
  async dead(agentId: string, sessionId: string): Promise<boolean> {
    checkAgentId(agentId)
    if (typeof sessionId !== "string" || !sessionId) return false
    const dead = await this.browser.dead(sessionId)
    if (dead) this.push()
    return dead
  }

  /** The agent closed its tabs. */
  release(agentId: string): void {
    this.browser.release(checkAgentId(agentId))
    this.push()
  }

  async reap(): Promise<void> {
    await this.browser.reap()
    this.push()
  }

  check(agentId?: string): BrowserCheck {
    const status = this.browser.status()
    return { connected: this.store.connected(), takeover: this.takeover(), mode: status?.mode ?? null, tabs: status?.tabs ?? {}, list: this.tabList(agentId ?? "") }
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

  /**
   * The live view URL for the human. A headless browser has none, so it is switched to headful first
   * (about 5 s, `onSwitching` tells the caller). With no browser open, one is made headful straight away: asking
   * to watch is a reason to open it. `control` sets the takeover flag before the switch, so agents stop at once,
   * and the switch carries it over. Watch keeps the browser for `WATCH_MS`.
   */
  private async openLink(mode: "watch" | "control", onSwitching: (on: boolean) => void): Promise<string> {
    if (!this.store.connected()) throw new KernelError("failed", "Kernel is not connected")
    const hold = () => (mode === "control" ? this.browser.setTakeover(true) : this.browser.watchUntil(Date.now() + WATCH_MS))
    const row = this.store.lease()
    if (row && !row.dead) hold()
    if (!row || row.dead || row.mode === "headless") {
      onSwitching(true)
      try {
        await this.browser.switchMode("headful")
      } finally {
        onSwitching(false)
      }
      hold()
    }
    const live = (await this.store.urls())?.liveUrl
    if (!live) throw new KernelError("failed", "Kernel gave no live view for this browser")
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

  /** The current browser's Kernel session id. It is no secret: it names the browser, it does not reach it. */
  sessionId(): string | null {
    return this.store.lease()?.sessionId ?? null
  }

  /** HTTP through the browser's stack, with its cookies and proxy. Only http and https. The client caps the body and says so in `truncated`. */
  async fetch(req: CurlRequest): Promise<CurlResponse> {
    if (typeof req?.url !== "string" || req.url.length > URL_CAP || !/^https?:\/\//i.test(req.url)) throw new KernelError("failed", "only http and https urls")
    if (req.method !== undefined && FETCH_METHODS[req.method] !== true) throw new KernelError("failed", "bad method")
    const sessionId = this.liveSession()
    return (await this.client()).curl(sessionId, req)
  }

  /** Writes a file onto the browser's VM. `name` is already a basename; the path is per session. */
  async putFile(name: string, bytes: Uint8Array): Promise<{ path: string }> {
    const sessionId = this.liveSession()
    const path = `${UPLOAD_DIR}/${sessionId}/${name}`
    await (await this.client()).writeFile(sessionId, path, bytes)
    return { path }
  }

  /** Reads a file from the browser's VM. Only `/tmp` and the Kernel downloads directory. */
  async getFile(path: string): Promise<Uint8Array> {
    if (!ALLOWED_READ.test(path) || path.includes("..")) throw new KernelError("failed", "only files under /tmp or the downloads folder")
    const sessionId = this.liveSession()
    return (await this.client()).readFile(sessionId, path)
  }

  /** Names of the files in a folder on the browser's VM. Only `/tmp` and the Kernel downloads directory. */
  async listFiles(dir: string): Promise<string[]> {
    if (!ALLOWED_READ.test(`${dir}/`) || dir.includes("..")) throw new KernelError("failed", "only folders under /tmp or the downloads folder")
    const sessionId = this.liveSession()
    return (await this.client()).listFiles(sessionId, dir)
  }

  /** DEVELOPMENT ONLY. Moves the browser's clocks back, so the reaper's time is up. */
  age(ms: number): void {
    const row = this.store.lease()
    if (row) this.store.patchLease({ lastUse: row.lastUse - ms, ...(row.watchUntil ? { watchUntil: Math.max(1, row.watchUntil - ms) } : {}) })
  }

  private liveSession(): string {
    const row = this.store.connected() ? this.store.lease() : undefined
    if (!row || row.dead) throw new KernelError("failed", "No browser is open")
    return row.sessionId
  }

  private async closeBrowser(): Promise<void> {
    if (!this.store.connected()) return
    // Best effort: the key may be dead already, and Kernel's own timeout is the net.
    await this.browser.close().catch(() => undefined)
  }

  private async client(): Promise<KernelClient> {
    const key = await this.store.key()
    if (!key) throw new KernelError("failed", "Kernel is not connected")
    return this.clientFor(key)
  }

  /** Tells every ready socket the browser changed. A touch that changes nothing the client shows sends nothing. */
  push(): void {
    const text = JSON.stringify({ t: "browserState", state: this.browserState() } satisfies UserToClient)
    if (text === this.sent) return
    this.sent = text
    for (const ws of this.d.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.ready) trySend(ws, text)
    }
  }

  async browserFrame(ws: WebSocket, frame: Extract<UserFrame, { t: "browserLink" | "handBack" | "closeBrowser" }>): Promise<void> {
    if (frame.t === "handBack") {
      if (this.store.lease()) this.browser.setTakeover(false)
    } else if (frame.t === "closeBrowser") {
      await this.browser.close().catch((e) => console.error(`close browser failed: ${kernelErrorText(e)}`))
    } else {
      let result: BrowserLinkResult
      try {
        const url = await this.link(frame.mode)
        result = { ok: true, url }
      } catch (e) {
        result = { ok: false, error: kernelErrorText(e) }
      }
      // The URL goes to this socket alone and is never stored.
      send(ws, { t: "browserLink", reqId: frame.reqId, result })
    }
    this.push()
  }

  async kernelFrame(ws: WebSocket, frame: Extract<UserFrame, { t: "connectKernel" | "disconnectKernel" | "kernelStatus" }>): Promise<KernelResult> {
    let result: KernelResult
    try {
      if (frame.t === "connectKernel") result = { ok: true, status: await this.connect(frame.apiKey) }
      else if (frame.t === "disconnectKernel") {
        await this.disconnect()
        result = { ok: true, status: this.status() }
      } else result = { ok: true, status: this.status() }
    } catch (e) {
      result = { ok: false, error: kernelErrorText(e) }
    }
    send(ws, { t: "kernel", reqId: frame.reqId, result })
    if (frame.t === "kernelStatus") send(ws, { t: "browserState", state: this.browserState() })
    this.push()
    if (result.ok && frame.t !== "kernelStatus") {
      const text = JSON.stringify({ t: "kernel", result } satisfies UserToClient)
      for (const other of this.d.ctx.getWebSockets()) {
        if (other !== ws && (other.deserializeAttachment() as Attachment | null)?.ready) trySend(other, text)
      }
    }
    return result
  }
}
