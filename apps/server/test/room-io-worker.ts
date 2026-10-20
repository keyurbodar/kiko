import { MeteredOwner } from "./owner-meter"
import { ownerName } from "../src/lib/names"
export { MeteredOwner }
type Env = { OWNER: DurableObjectNamespace<MeteredOwner> }
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, roomId, method] = new URL(request.url).pathname.split("/")
    const stub = env.OWNER.get(env.OWNER.idFromName(ownerName("alice")))
    if (kind === "counts") return Response.json(await stub.counts())
    if (kind === "call") {
      const args = await request.json<Parameters<MeteredOwner["roomCall"]>[2]>()
      if (method === "wake") return Response.json(await stub.wake() ?? null)
      if (method === "plan") return Response.json(await stub.plan(...(args as [string, ...SqlStorageValue[]])))
      return Response.json(await stub.roomCall(roomId!, method as Parameters<MeteredOwner["roomCall"]>[1], args) ?? null)
    }
    return stub.fetch(request)
  },
}
