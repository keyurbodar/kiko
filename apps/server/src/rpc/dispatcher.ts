import { ProtocolError, type OwnerRpcs } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { STORAGE_ERROR } from "../lib/storage-error"
import { unsubscribe } from "../owner/socket"
import type { Cx } from "./handlers"
import { codecs, dieFrame, exitFrame, parseIncoming, RPC_PONG, type IncomingRequest } from "./wire"

const BAD_FRAME = 1008

type AnyHandler = (payload: unknown, cx: Cx) => Effect.Effect<unknown, unknown>
export type HandlerTable = { readonly [Tag in OwnerRpcs["_tag"]]?: unknown }
export type Context = Omit<Cx, "requestId">

const send = (ws: WebSocket, text: string) => {
  try {
    ws.send(text)
  } catch {}
}

const sendExit = (ws: WebSocket, request: IncomingRequest, exit: Exit.Exit<unknown, unknown>) => {
  const codec = codecs(request.tag)
  try {
    send(ws, exitFrame(request.id, codec ? codec.encodeExit(exit) : null))
  } catch (e) {
    send(ws, dieFrame(request.id, `Kiko could not encode the ${request.tag} reply: ${String(e)}`))
  }
}

const storageOnDefect = (tag: string) =>
  Effect.catchDefect((defect: unknown) => {
    console.error(`rpc ${tag} failed: ${defect instanceof Error ? defect.message : String(defect)}`)
    return Effect.fail(STORAGE_ERROR)
  })

const ended = (host: Context["host"], sub: { readonly stream: string } | null) => {
  if (sub) host.streamEnded?.(sub.stream)
}

async function request(handlers: HandlerTable, cx: Context, req: IncomingRequest): Promise<void> {
  const { ws } = cx
  const codec = codecs(req.tag)
  if (!codec) return send(ws, dieFrame(req.id, `Kiko does not know ${req.tag}.`))
  let payload: unknown
  try {
    payload = codec.decodePayload(req.payload)
  } catch (e) {
    return sendExit(ws, req, Exit.fail(new ProtocolError({ message: `Bad ${req.tag} payload: ${String(e)}` })))
  }
  const handler = handlers[req.tag as OwnerRpcs["_tag"]] as AnyHandler | undefined
  if (!handler) return sendExit(ws, req, Exit.fail(new ProtocolError({ message: `${req.tag} is not served.` })))
  const exit = await Effect.runPromiseExit(
    Effect.suspend(() => handler(payload, { ...cx, requestId: req.id })).pipe(storageOnDefect(req.tag)),
  )
  if (codec.stream && Exit.isSuccess(exit)) return
  if (codec.stream) ended(cx.host, unsubscribe(ws, req.id))
  sendExit(ws, req, exit)
}

export async function dispatch(handlers: HandlerTable, cx: Context, raw: string | ArrayBuffer): Promise<void> {
  const messages = typeof raw === "string" ? parseIncoming(raw) : null
  if (!messages) {
    cx.ws.close(BAD_FRAME, "bad rpc frame")
    return
  }
  for (const message of messages) {
    if (message._tag === "Ping") send(cx.ws, RPC_PONG)
    else if (message._tag === "Interrupt") ended(cx.host, unsubscribe(cx.ws, message.requestId))
    else if (message._tag === "Request") await request(handlers, cx, message)
  }
}
