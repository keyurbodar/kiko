import { ProtocolError, type OwnerRpcs } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { HANDLERS, unsubscribe, type Cx, type RpcHost } from "./handlers"
import { codecs, dieFrame, exitFrame, parseIncoming, RPC_PONG, type IncomingRequest } from "./wire"

const BAD_FRAME = 1008

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

type AnyHandler = (payload: unknown, cx: Cx) => Effect.Effect<unknown, unknown>

async function request(host: RpcHost, ws: WebSocket, req: IncomingRequest): Promise<void> {
  const codec = codecs(req.tag)
  if (!codec) return send(ws, dieFrame(req.id, `Kiko does not know ${req.tag}.`))
  let payload: unknown
  try {
    payload = codec.decodePayload(req.payload)
  } catch (e) {
    return sendExit(ws, req, Exit.fail(new ProtocolError({ message: `Bad ${req.tag} payload: ${String(e)}` })))
  }
  const handler = HANDLERS[req.tag as OwnerRpcs["_tag"]] as AnyHandler | undefined
  if (!handler) return sendExit(ws, req, Exit.fail(new ProtocolError({ message: `${req.tag} is not served yet.` })))
  const exit = await Effect.runPromiseExit(handler(payload, { host, ws, requestId: req.id }))
  if (codec.stream && Exit.isSuccess(exit)) return
  if (codec.stream) unsubscribe(ws, req.id)
  sendExit(ws, req, exit)
}

export async function dispatch(host: RpcHost, ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
  const messages = typeof raw === "string" ? parseIncoming(raw) : null
  if (!messages) {
    ws.close(BAD_FRAME, "bad rpc frame")
    return
  }
  for (const message of messages) {
    if (message._tag === "Ping") send(ws, RPC_PONG)
    else if (message._tag === "Interrupt") unsubscribe(ws, message.requestId)
    else if (message._tag === "Request") await request(host, ws, message)
  }
}
