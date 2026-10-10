import type { ServerWebSocket } from "bun"

export type Sent = { id: number; method: string; params: Record<string, unknown>; sessionId?: string }
type Socket = ServerWebSocket<unknown>
/** Return a result, or undefined to stay silent. */
export type Handler = (message: Sent, ws: Socket, fake: FakeCdp) => unknown

export type FakeCdp = {
  url: string
  sent: Sent[]
  emit(method: string, params: unknown, sessionId?: string): void
  stop(): void
}

/** A scripted CDP endpoint. Unknown methods answer {}. */
export function fakeCdp(handlers: Record<string, Handler> = {}): FakeCdp {
  let socket: Socket | undefined
  const sent: Sent[] = []
  const fake: FakeCdp = {
    url: "",
    sent,
    emit(method, params, sessionId) {
      socket?.send(JSON.stringify(sessionId ? { method, params, sessionId } : { method, params }))
    },
    stop: () => {
      void server.stop(true)
    },
  }
  const server = Bun.serve({
    port: 0,
    fetch(request, srv) {
      if (srv.upgrade(request)) return undefined
      return new Response("no", { status: 400 })
    },
    websocket: {
      open(ws) {
        socket = ws
      },
      message(ws, raw) {
        const message = JSON.parse(String(raw)) as Sent
        sent.push(message)
        const handler = handlers[message.method]
        const result = handler ? handler(message, ws, fake) : {}
        if (result === undefined) return
        ws.send(JSON.stringify(message.sessionId ? { id: message.id, result, sessionId: message.sessionId } : { id: message.id, result }))
      },
    },
  })
  fake.url = `ws://localhost:${server.port}/devtools/browser`
  return fake
}
