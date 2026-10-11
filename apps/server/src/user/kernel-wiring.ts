import type { Alarms } from "@yuki/durable/alarm"
import { keyringFromEnv } from "@yuki/durable/crypto"
import { isAgentSlug, isRoomId, type BrowserLinkResult, type BrowserState, type ClientToUser as UserFrame, type KernelResult, type UserToClient } from "@yuki/protocol"
import type { Env } from "../index"
import { checkAgentId, KernelConnection, kernelErrorText } from "../integrations/kernel/connect"
import { REAP_WAKEUP } from "../integrations/kernel/lease"
import { KernelStore } from "../integrations/kernel/store"
import { roomStub } from "../lib/names"
import { type Attachment, send, trySend } from "./sockets"

export type KernelDeps = {
  ctx: DurableObjectState
  sql: SqlStorage
  env: Env
  alarms: Alarms
  userId: () => string
}

/** The agent slug at the end of a lease id such as `room/slug`. */
function slugOf(agentId: string): string {
  return agentId.split(/[/:]/).pop() ?? agentId
}

// The user's one Kernel browser, leased to their agents (architecture section 27). The CDP URL
// goes to the agent that asked and nowhere else. The Kernel key never leaves this object.
export class KernelWiring {
  readonly kernel: KernelConnection
  private switching = false
  private sent = ""
  private readonly d: KernelDeps

  constructor(d: KernelDeps) {
    this.d = d
    const userId = d.userId
    this.kernel = new KernelConnection({
      store: new KernelStore(d.sql, () => ({ keyring: keyringFromEnv(d.env), userId: userId() })),
      userId,
      wake: { set: (at) => d.alarms.setWakeup(REAP_WAKEUP, at), clear: () => d.alarms.clearWakeup(REAP_WAKEUP) },
    })
  }

  /** The user's browser for `agentId`, headless unless the human asked to watch. Creates it when there is none. */
  async lease(agentId: string) {
    const info = await this.kernel.leaseFor(agentId)
    this.push()
    return info
  }

  /** Stamps last use. `tabs` (tab id to last URL) replaces the agent's tabs. False when the browser it knew is gone. */
  touch(agentId: string, tabs?: Record<string, string>): boolean {
    const known = this.kernel.touch(agentId, tabs)
    this.push()
    return known
  }

  /**
   * An agent asks the human to look at the browser, for a sign-in or a captcha. Posts the reason as a plain
   * message, with no link: the browser bar's Watch and Take over ask for it. `agentId` ends in the agent's slug
   * (after the last "/" or ":"). Returns false when the agent is not in that room.
   */
  async share(agentId: string, roomId: string, reason: string): Promise<boolean> {
    checkAgentId(agentId)
    const slug = slugOf(agentId)
    if (!isRoomId(roomId) || !isAgentSlug(slug) || typeof reason !== "string") return false
    const text = reason.trim().slice(0, 300)
    if (!text) return false
    return roomStub(this.d.env.ROOM, this.d.userId(), roomId).browserShare(slug, text)
  }

  /** The agent's socket died: the next lease makes a new browser. */
  async dead(agentId: string, sessionId: string): Promise<boolean> {
    const dead = await this.kernel.markDead(agentId, sessionId)
    if (dead) this.push()
    return dead
  }

  /** The agent closed its tabs. */
  release(agentId: string): void {
    this.kernel.release(agentId)
    this.push()
  }

  async reap(): Promise<void> {
    await this.kernel.reap()
    this.push()
  }

  browserState(): BrowserState {
    return this.kernel.browserState(this.switching, (agentId) => {
      const slug = slugOf(agentId)
      const row = this.d.sql.exec<{ name: string }>("SELECT name FROM agents WHERE slug = ?", slug).toArray()[0]
      return { slug, name: row?.name ?? slug }
    })
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
    const kernel = this.kernel
    if (frame.t === "handBack") kernel.handBack()
    else if (frame.t === "closeBrowser") {
      await kernel.closeNow().catch((e) => console.error(`close browser failed: ${kernelErrorText(e)}`))
    } else {
      let result: BrowserLinkResult
      try {
        const url = await kernel.openLink(frame.mode, (on) => {
          this.switching = on
          this.push()
        })
        result = { ok: true, url }
      } catch (e) {
        result = { ok: false, error: kernelErrorText(e) }
      }
      // The URL goes to this socket alone and is never stored.
      send(ws, { t: "browserLink", reqId: frame.reqId, result })
    }
    this.push()
  }

  async kernelFrame(ws: WebSocket, frame: Extract<UserFrame, { t: "connectKernel" | "disconnectKernel" | "kernelStatus" }>): Promise<void> {
    const kernel = this.kernel
    let result: KernelResult
    try {
      if (frame.t === "connectKernel") result = { ok: true, status: await kernel.connect(frame.apiKey) }
      else if (frame.t === "disconnectKernel") {
        await kernel.disconnect()
        result = { ok: true, status: kernel.status() }
      } else result = { ok: true, status: kernel.status() }
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
  }
}
