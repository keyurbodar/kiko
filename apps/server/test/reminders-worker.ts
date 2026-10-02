import { RoomDO as BaseRoom } from "../src/room/room-do"
import { roomName, userStub } from "../src/lib/names"
import type { UserDO } from "../src/user/user-do"

// The real UserDO and RoomDO, with no session check. `/user/<user>` calls one UserDO
// RPC by name. `/room/<user>/<roomId>` returns the room's messages.

export { UserDO } from "../src/user/user-do"

/** The room plus one read method, so the test can count what was stored. */
export class RoomDO extends BaseRoom {
  async messages() {
    return this.log.snapshot().messages
  }
}

type Env = { USER: DurableObjectNamespace<UserDO>; ROOM: DurableObjectNamespace<RoomDO> }

export default {
  async fetch(request: Request, env: Env) {
    const [, kind, user, roomId] = new URL(request.url).pathname.split("/")
    if (kind === "room") return Response.json(await env.ROOM.get(env.ROOM.idFromName(roomName(user!, roomId!))).messages())
    const stub = userStub(env.USER, user!)
    const { method, args } = (await request.json()) as { method: string; args: unknown[] }
    const result = await (stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...args)
    return Response.json({ result: result ?? null })
  },
}
