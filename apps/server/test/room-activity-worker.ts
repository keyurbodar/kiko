import { FeatureOwner as ForFeatureTests } from "./feature-owner"
import { ownerName } from "../src/lib/names"

// The room's queue of undelivered envelopes is a room table, so the question is asked in the room.
export class FeatureOwner extends ForFeatureTests {
  async pendingRows(roomId: string): Promise<number> {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM pending WHERE pending.room_id = ?", roomId).one().n
  }
}

type Env = { OWNER: DurableObjectNamespace<FeatureOwner> }
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, roomId, method, argument] = new URL(request.url).pathname.split("/")
    const stub = env.OWNER.get(env.OWNER.idFromName(ownerName("alice")))
    if (kind === "rpc" && method === "pendingRows") return Response.json(await stub.pendingRows(roomId!))
    if (kind === "rpc") return Response.json(await stub.roomCall(roomId!, method as Parameters<FeatureOwner["roomCall"]>[1], await request.json<Parameters<FeatureOwner["roomCall"]>[2]>()) ?? null)
    if (["touches", "errors", "problems", "typing"].includes(kind!)) return Response.json(await stub.observations(kind!, roomId))
    if (kind === "agent") {
      if (argument === "answers") return Response.json(await stub.observations("answers", roomId, method))
      await stub.agentWaiting(roomId!, method!, argument === "1")
      return new Response("ok")
    }
    return stub.fetch(request)
  },
}
