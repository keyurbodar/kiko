import { FeatureOwner } from "./feature-owner"
import { ownerName } from "../src/lib/names"
import type { RoomId } from "@kiko/protocol"
export { FeatureOwner }
type Env = { OWNER: DurableObjectNamespace<FeatureOwner> }
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, roomId, method] = new URL(request.url).pathname.split("/")
    const stub = env.OWNER.get(env.OWNER.idFromName(ownerName("alice")))
    if (kind === "rpc") return Response.json(await stub.roomCall(roomId!, method as Parameters<FeatureOwner["roomCall"]>[1], await request.json<Parameters<FeatureOwner["roomCall"]>[2]>()) ?? null)
    if (kind === "kiko") { await stub.markKiko(roomId as RoomId); return new Response("ok") }
    if (["opened", "saved", "agent"].includes(kind!)) return Response.json(await stub.observations(kind!, roomId, method))
    return stub.fetch(request)
  },
}
