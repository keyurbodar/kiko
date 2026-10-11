import { DurableObject } from "cloudflare:workers"
import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import { route } from "../src/router"

function echo(ctx: DurableObjectState, request: Request): Response {
  const [client, server] = Object.values(new WebSocketPair())
  server!.accept()
  server!.send(
    JSON.stringify({
      id: ctx.id.toString(),
      user: request.headers.get(USER_ID_HEADER),
      room: request.headers.get(ROOM_ID_HEADER),
    }),
  )
  return new Response(null, { status: 101, webSocket: client })
}

export class UserDO extends DurableObject {
  async fetch(request: Request) {
    return echo(this.ctx, request)
  }

  async recordRoom() {
    return true
  }
}

export class RoomDO extends DurableObject {
  async fetch(request: Request) {
    return echo(this.ctx, request)
  }
}

async function session(request: Request) {
  const id = /(?:^|;\s*)session=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1]
  return id ? { id } : null
}

export default {
  async fetch(request: Request, env: never) {
    return (await route(request, env, session)) ?? new Response("not found", { status: 404 })
  },
}
