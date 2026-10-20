import { MeteredOwner } from "./owner-meter"
import { ownerName } from "../src/lib/names"
export { MeteredOwner }
type Env = { OWNER: DurableObjectNamespace<MeteredOwner> }
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, ...rest] = new URL(request.url).pathname.split("/")
    const stub = env.OWNER.get(env.OWNER.idFromName(ownerName("alice")))
    const [roomId, operation, method] = rest
    const op = kind === "user" ? roomId : operation
    if (op === "counts") return Response.json(await stub.counts())
    if (op === "wake") return Response.json(await stub.wake() ?? null)
    if (kind === "user" && op === "home") return Response.json(await stub.userCall("ensureHome", []))
    if (op === "call") return Response.json(await stub.roomCall(roomId!, method as Parameters<MeteredOwner["roomCall"]>[1], await request.json<Parameters<MeteredOwner["roomCall"]>[2]>()) ?? null)
    return stub.fetch(request)
  },
}
