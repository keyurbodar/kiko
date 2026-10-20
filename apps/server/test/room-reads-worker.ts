import { MeteredOwner } from "./owner-meter"
import { ownerName } from "../src/lib/names"
export { MeteredOwner }
type Env = { OWNER: DurableObjectNamespace<MeteredOwner> }
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, roomId] = new URL(request.url).pathname.split("/")
    const stub = env.OWNER.get(env.OWNER.idFromName(ownerName("alice")))
    if (kind === "reads") return Response.json(await stub.rowsRead())
    if (kind === "plan") return Response.json(await stub.windowPlans(roomId!))
    if (kind === "chatter") { await stub.agentChatter(roomId!, Number(await request.text())); return new Response("ok") }
    return stub.fetch(request)
  },
}
