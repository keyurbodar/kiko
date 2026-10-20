import { OwnerDO } from "../src/owner/owner-do"
import { ownerName } from "../src/lib/names"

export { OwnerDO }

type Env = { OWNER: DurableObjectNamespace<OwnerDO> }

export default {
  async fetch(request: Request, env: Env) {
    const [, kind, user] = new URL(request.url).pathname.split("/")
    const stub = env.OWNER.get(env.OWNER.idFromName(ownerName(user!)))
    if (kind === "ws") return stub.fetch(request)
    const { method, args } = await request.json<{ method: Parameters<OwnerDO["userCall"]>[0]; args: Parameters<OwnerDO["userCall"]>[1] }>()
    const result = await stub.userCall(method, args)
    return Response.json({ result: result ?? null })
  },
}
