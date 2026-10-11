import { DurableObject } from "cloudflare:workers"
import { experimentTurnRoute } from "../src/experiments/turn"
import { quickjsProbe } from "./quickjs-probe"
export { AgentDO } from "../src/agent/agent-do"

const spin = (ms: number) => {
  // Date.now() does not advance inside a Worker's synchronous code, so loop a fixed count. ms is millions.
  let n = 0
  for (let i = 0; i < ms * 1_000_000; i++) n += i & 1
  return n
}

export class SpinDO extends DurableObject {
  async quickjs(calls: number) {
    return quickjsProbe(calls)
  }

  async fetchMany(n: number, background: boolean, viaSelf = false) {
    const self = (this.env as { SPIN: DurableObjectNamespace<SpinDO> }).SPIN.get(this.ctx.id)
    const run = async () => {
      let ok = 0
      let error: string | null = null
      for (let i = 0; i < n; i++) {
        try {
          if (viaSelf) {
            const r = await self.egress(new Request(`https://example.com/?s=${i}`))
            await r.arrayBuffer()
          } else {
            const r = await fetch(`https://example.com/?i=${i}`)
            await r.arrayBuffer()
          }
          ok++
        } catch (e) {
          error = `at ${i}: ${e instanceof Error ? e.message : String(e)}`
          break
        }
      }
      await this.ctx.storage.put("fetch-result", { n, ok, error, background })
      return { n, ok, error }
    }
    if (!background) return run()
    void run()
    return { started: n }
  }

  async egress(request: Request): Promise<Response> {
    return fetch(request)
  }

  async fetchOne(i: number) {
    await (await fetch(`https://example.com/?p=${i}`)).arrayBuffer()
    return i
  }

  async ping() {
    return 1
  }

  async viaRpc(n: number, target: "other" | "self", withFetch: boolean) {
    const env = this.env as { SPIN: DurableObjectNamespace<SpinDO> }
    const stub = target === "self" ? env.SPIN.get(this.ctx.id) : env.SPIN.get(env.SPIN.idFromName(`peer-${this.ctx.id.toString()}`))
    let ok = 0
    let error: string | null = null
    for (let i = 0; i < n; i++) {
      try {
        if (withFetch) await stub.fetchOne(i)
        else await stub.ping()
        ok++
      } catch (e) {
        error = `at ${i}: ${e instanceof Error ? e.message : String(e)}`
        break
      }
    }
    return { n, target, withFetch, ok, error }
  }

  async fetchResult() {
    return (await this.ctx.storage.get("fetch-result")) ?? null
  }

  async spin(ms: number) {
    spin(ms)
    return ms
  }
}

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url)
    if (url.pathname === "/api/experiments/turn") return experimentTurnRoute(request, env)
    const ms = Number(url.searchParams.get("ms") ?? 200)
    if (url.pathname === "/spin-worker") return Response.json({ spun: spin(ms) > 0, ms })
    const n = Number(url.searchParams.get("n") ?? 10)
    const stub = () => env.SPIN.get(env.SPIN.idFromName(url.searchParams.get("obj") ?? "spin"))
    if (url.pathname === "/fetch-do") return Response.json(await stub().fetchMany(n, url.searchParams.has("bg"), url.searchParams.has("self")))
    if (url.pathname === "/rpc-do") return Response.json(await stub().viaRpc(n, (url.searchParams.get("target") as "other" | "self") ?? "other", url.searchParams.has("fetch")))
    if (url.pathname === "/fetch-do-result") return Response.json(await stub().fetchResult())
    if (url.pathname === "/fetch-worker") {
      let ok = 0
      let error: string | null = null
      for (let i = 0; i < n; i++) {
        try {
          await (await fetch(`https://example.com/?w=${i}`)).arrayBuffer()
          ok++
        } catch (e) {
          error = `at ${i}: ${e instanceof Error ? e.message : String(e)}`
          break
        }
      }
      return Response.json({ n, ok, error })
    }
    if (url.pathname === "/quickjs-do") return Response.json(await env.SPIN.get(env.SPIN.idFromName("spin")).quickjs(Number(url.searchParams.get("calls") ?? 1)))
    if (url.pathname === "/spin-do") return Response.json({ spun: await env.SPIN.get(env.SPIN.idFromName("spin")).spin(ms), ms })
    return new Response("not found", { status: 404 })
  },
}
