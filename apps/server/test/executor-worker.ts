import { executorCallbackRoute } from "../src/integrations/executor/connect"
import { UserDO as Base } from "../src/user/user-do"

// P7-03. The real `UserDO`, plus one method that reads the raw Executor rows so the test
// can prove they are sealed and that a disconnect leaves none. Executor itself is faked by
// the test through Miniflare's outbound service.

export class UserDO extends Base {
  rawExecutorRows(): { name: string; ciphertext: string }[] {
    return this.ctx.storage.sql
      .exec<{ name: string; ciphertext: ArrayBuffer }>("SELECT name, ciphertext FROM executor_secrets ORDER BY name")
      .toArray()
      .map((r) => ({ name: r.name, ciphertext: new TextDecoder().decode(r.ciphertext) }))
  }
}

type Env = { USER: DurableObjectNamespace<UserDO> }

// `/ws/<user>` opens the user socket. `/rpc/<user>` calls a method by name. The callback
// path runs the real route, with the session taken from an `x-test-user` header.
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith("/api/")) {
      const user = request.headers.get("x-test-user")
      const routed = await executorCallbackRoute(request, env as never, async () => (user ? { id: user } : null))
      return routed ?? new Response("not found", { status: 404 })
    }
    const [, kind, user] = url.pathname.split("/")
    const stub = env.USER.get(env.USER.idFromName(`user:${user}`))
    if (kind === "ws") return stub.fetch(request)
    const { method, args } = (await request.json()) as { method: string; args: unknown[] }
    try {
      const result = await (stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...args)
      console.log("rpc", method, method === "executorToken" ? "(token)" : JSON.stringify(result))
      return Response.json({ result: result ?? null })
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 })
    }
  },
}
