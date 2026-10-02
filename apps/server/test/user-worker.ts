import { UserDO } from "../src/user/user-do"

export { UserDO }

type Env = { USER: DurableObjectNamespace<UserDO> }

// `/ws/<user>` opens the user socket. `/rpc/<user>` calls one RPC method by name, so
// the test drives the same methods a room calls.
export default {
  async fetch(request: Request, env: Env) {
    const [, kind, user] = new URL(request.url).pathname.split("/")
    const stub = env.USER.get(env.USER.idFromName(`user:${user}`))
    if (kind === "ws") return stub.fetch(request)
    const { method, args } = (await request.json()) as { method: string; args: unknown[] }
    const result = await (stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...args)
    return Response.json({ result: result ?? null })
  },
}
