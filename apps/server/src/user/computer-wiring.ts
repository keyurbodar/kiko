import { isAgentSlug, isRoomId, type ClientToUser as UserFrame } from "@kiko/protocol"
import type { Op } from "@kiko/computer/wire"
import type { OwnerServices } from "../owner/services"
import { MAX_DEADLINE_MS, type ComputerHub } from "../computer/hub"
import { mintPairCode } from "../computer/pairing"
import type { ComputerLinkResult, PcCallOutcome, PcReleased } from "../computer/types"
import type { Env } from "../index"
import { send, type Attachment } from "./socket-frames"

export type ComputerFrame = Extract<UserFrame, { t: `pc.${string}` }>

const RESUMED = {
  released: "The human released control of the computer: it is yours again.",
  expired: "The human's control of the computer timed out after 30 minutes: it is yours again.",
} as const
const RESUME =
  " Carry on with the computer work that was waiting. Tell the worker that was waiting to continue with tell_work; the computer is where the human left it, so it does not need to set anything up again. Say one short line to the human only if there is something to say."

const NAME_MAX = 60
const MAX_REASON = 300
const PAIR_PATH = "/pc"

type ComputerDeps = {
  hub: ComputerHub
  ctx: DurableObjectState
  env: Env
  services: OwnerServices
  userId: () => string
  publicOrigin: () => Promise<string | null>
}

function slugOf(agentId: string): string {
  return agentId.split(/[/:]/).pop() ?? agentId
}

function workerOrigin(ws: WebSocket): string | null {
  return (ws.deserializeAttachment() as Attachment | null)?.workerOrigin ?? null
}

function pairUrl(origin: string | null, code: string): string {
  if (!origin) return `${PAIR_PATH}#${code}`
  try {
    return new URL(PAIR_PATH, origin).toString() + `#${code}`
  } catch {
    return `${PAIR_PATH}#${code}`
  }
}

export class ComputerWiring {
  private readonly d: ComputerDeps

  constructor(d: ComputerDeps) {
    this.d = d
  }

  get hub(): ComputerHub {
    return this.d.hub
  }

  list() {
    return this.hub.summaries()
  }

  find(nameOrId?: string): { id: string; name: string } | null {
    const all = this.hub.rows()
    if (nameOrId === undefined || nameOrId === "") return all.length === 1 ? (all[0] ?? null) : null
    return this.hub.find(nameOrId)
  }

  pair(input: {
    publicKey: string
    name: string
    hello: Parameters<ComputerHub["pair"]>[0]["hello"]
    pairNonce: string
  }) {
    const id = crypto.randomUUID()
    const created = this.hub.pair({ ...input, id })
    return created
      ? { ok: true as const, id, name: input.name }
      : { ok: false as const, error: "that pairing code was already used" }
  }

  call(
    agentId: string,
    roomId: string,
    pcId: string,
    op: Op,
    args: unknown,
    deadlineMs?: number,
  ): Promise<PcCallOutcome> {
    const slug = slugOf(agentId)
    if (!isAgentSlug(slug) || !isRoomId(roomId))
      return Promise.resolve({ ok: false, code: "failed", message: "Unknown room or agent" })
    const row = this.find(pcId)
    if (!row) return Promise.resolve({ ok: false, code: "unsupported", message: "there is no such computer" })
    return this.hub.call(row.id, op, args, {
      deadlineMs: Math.min(Number(deadlineMs ?? MAX_DEADLINE_MS), MAX_DEADLINE_MS),
      user: { key: `${roomId}:${agentId}`, name: slug },
    })
  }

  async link(
    agentId: string,
    roomId: string,
    pcId: string,
    mode: "watch" | "control",
    reason?: string,
  ): Promise<ComputerLinkResult> {
    const slug = slugOf(agentId)
    if (!isAgentSlug(slug) || !isRoomId(roomId)) return { ok: false, error: "Unknown room or agent" }
    const row = this.find(pcId)
    if (!row) return { ok: false, error: "there is no such computer" }
    const why = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON) : ""
    if (this.hub.link(row.id, { slug, roomId, ...(why ? { reason: why } : {}) }) === "missing")
      return { ok: false, error: "there is no such computer" }
    if (mode === "control")
      await this.d.services.room(roomId).computerAsk(slug, { id: row.id, name: row.name }, why, `${Date.now()}`)
    return { ok: true }
  }

  holder(pcId: string): "agent" | "human" {
    const row = this.find(pcId)
    return row ? this.hub.holder(row.id) : "agent"
  }

  onTabHello(ws: WebSocket): void {
    this.hub.sendState(ws)
  }

  async frame(ws: WebSocket, frame: ComputerFrame): Promise<void> {
    if (frame.t === "pc.pairCode") {
      const minted = await mintPairCode(this.d.env.CREDENTIALS_KEK, this.d.userId())
      send(ws, {
        t: "pc.pairCode",
        reqId: frame.reqId,
        code: minted.code,
        url: pairUrl(workerOrigin(ws) ?? (await this.d.publicOrigin()), minted.code),
        expiresAt: minted.expiresAt,
      })
      return
    }
    if (frame.t === "pc.remove" || frame.t === "pc.rename") return this.nameFrame(ws, frame)
    const row = this.find(frame.pcId)
    if (!row) return
    if (frame.t === "pc.watch") {
      if (frame.on && (frame.mode ?? "rtc") === "rtc") await this.hub.watchRtc(row.id, ws)
      else this.hub.watch(row.id, ws, frame.on, frame.mode ?? "rtc")
    } else if (frame.t === "pc.take") this.take(ws, row.id, row.name)
    else if (frame.t === "pc.release") this.released(this.hub.release(row.id))
    else if (frame.t === "pc.rtc") await this.hub.rtcFromTab(ws, row.id, frame.signal)
    else if (frame.t === "pc.input") this.hub.input(row.id, frame.events)
    else this.hub.ack(row.id, frame.seq)
  }

  private take(ws: WebSocket, id: string, name: string): void {
    if (!this.hub.take(id, ws)) send(ws, { t: "pc.result", reqId: id, ok: false, error: `${name} is not connected` })
  }

  private nameFrame(ws: WebSocket, frame: Extract<ComputerFrame, { t: "pc.remove" | "pc.rename" }>): void {
    const row = this.find(frame.pcId)
    const name = frame.t === "pc.rename" ? frame.name.trim().slice(0, NAME_MAX) : ""
    if (frame.t === "pc.remove" && row) this.hub.remove(row.id)
    const ok = frame.t === "pc.remove" ? row !== null : row !== null && name.length > 0 && this.hub.rename(row.id, name)
    send(ws, {
      t: "pc.result",
      reqId: frame.reqId,
      ok,
      ...(ok ? {} : { error: frame.t === "pc.rename" && !name ? "a name is required" : "there is no such computer" }),
    })
  }

  close(ws: WebSocket): Promise<void> {
    return this.hub.close(ws)
  }

  released(out: PcReleased): void {
    const why = out.expired ? "expired" : "released"
    for (const waiter of out.waiters) {
      if (!isRoomId(waiter.roomId) || !isAgentSlug(waiter.slug)) continue
      const wake = this.d.services.room(waiter.roomId).wake({
        id: `computer-back:${out.pcId}:${Date.now()}:${waiter.slug}`,
        to: waiter.slug,
        why: "system",
        body: `${RESUMED[why]}${RESUME}`,
        chain: null,
      })
      this.d.ctx.waitUntil(
        Promise.resolve(wake).catch((e) =>
          console.error(`computer resume wake failed: ${e instanceof Error ? e.message : String(e)}`),
        ),
      )
    }
  }
}
