import {
  isAgentSlug,
  isRoomId,
  NotFoundError,
  RefusedError,
  type ComputerInput,
  type ComputerSignal,
} from "@kiko/protocol"
import * as Effect from "effect/Effect"
import type { Op } from "@kiko/computer/wire"
import type { OwnerServices } from "../owner/services"
import { MAX_DEADLINE_MS, type ComputerHub } from "../computer/hub"
import { mintPairCode } from "../computer/pairing"
import type { ComputerLinkResult, PcCallOutcome, PcReleased } from "../computer/types"
import type { Env } from "../index"
import type { Attachment } from "./socket-frames"
import { slugOf } from "./agent-id"
import { subscribe } from "../owner/socket"
import { frameStream } from "../computer/frames"
import type { RequestId } from "../rpc/wire"

const missing = () => new NotFoundError({ resource: "computer", message: "there is no such computer" })

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
    replaces?: string
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

  readonly pairCode = Effect.fn("Computers.pairCode")({ self: this }, function* (socket: WebSocket) {
    const minted = yield* Effect.promise(() => mintPairCode(this.d.env.CREDENTIALS_KEK, this.d.userId()))
    const origin = workerOrigin(socket) ?? (yield* Effect.promise(() => this.d.publicOrigin()))
    return { code: minted.code, url: pairUrl(origin, minted.code), expiresAt: minted.expiresAt }
  })

  readonly remove = Effect.fn("Computers.remove")({ self: this }, function* (pcId: string) {
    const row = yield* this.row(pcId)
    this.hub.remove(row.id)
  })

  readonly rename = Effect.fn("Computers.rename")({ self: this }, function* (pcId: string, name: string) {
    const row = yield* this.row(pcId)
    const clean = name.trim().slice(0, NAME_MAX)
    if (!clean) return yield* new RefusedError({ reason: "name", message: "a name is required" })
    if (!this.hub.rename(row.id, clean)) return yield* missing()
  })

  readonly watch = Effect.fn("Computers.watch")(
    { self: this },
    function* (socket: WebSocket, pcId: string, on: boolean, mode: "rtc" | "relay" = "rtc") {
      const row = yield* this.row(pcId)
      if (on && mode === "rtc") yield* Effect.promise(() => this.hub.watchRtc(row.id, socket))
    },
  )

  readonly frames = Effect.fn("Computers.frames")(
    { self: this },
    function* (socket: WebSocket, requestId: RequestId, pcId: string) {
      const row = yield* this.row(pcId)
      subscribe(socket, { requestId, stream: frameStream(row.id), cursor: 0 })
      this.hub.syncRelay(row.id, true)
    },
  )

  ended(stream: string): void {
    if (stream.startsWith("pc:")) this.hub.syncRelay(stream.slice("pc:".length))
  }

  readonly take = Effect.fn("Computers.take")({ self: this }, function* (socket: WebSocket, pcId: string) {
    const row = yield* this.row(pcId)
    if (!this.hub.take(row.id, socket))
      return yield* new RefusedError({ reason: "offline", message: `${row.name} is not connected` })
  })

  readonly release = Effect.fn("Computers.release")({ self: this }, function* (pcId: string) {
    const row = yield* this.row(pcId)
    this.released(this.hub.release(row.id))
  })

  readonly rtc = Effect.fn("Computers.rtc")(
    { self: this },
    function* (socket: WebSocket, pcId: string, signal: ComputerSignal) {
      const row = yield* this.row(pcId)
      yield* Effect.promise(() => this.hub.rtcFromTab(socket, row.id, signal))
    },
  )

  readonly input = Effect.fn("Computers.input")(
    { self: this },
    function* (pcId: string, events: readonly ComputerInput[]) {
      const row = yield* this.row(pcId)
      this.hub.input(row.id, events)
    },
  )

  readonly ack = Effect.fn("Computers.ack")({ self: this }, function* (pcId: string, seq: number) {
    const row = yield* this.row(pcId)
    this.hub.ack(row.id, seq)
  })

  readonly listForTab = Effect.fn("Computers.list")({ self: this }, function (socket: WebSocket) {
    return Effect.sync(() => this.hub.summaries(socket))
  })

  private row(pcId: string) {
    return Effect.suspend(() => {
      const row = this.find(pcId)
      return row ? Effect.succeed(row) : Effect.fail(missing())
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
