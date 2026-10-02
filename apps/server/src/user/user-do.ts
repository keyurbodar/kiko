import { DurableObject } from "cloudflare:workers"
import type { Env } from "../index"

export class UserDO extends DurableObject<Env> {
  // Placeholder from P1-03 so the routed socket opens. The socket task replaces it.
  async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server!)
    return new Response(null, { status: 101, webSocket: client })
  }
}
