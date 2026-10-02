import { DurableObject } from "cloudflare:workers"
import { experimentTurnRoute } from "../src/experiments/turn"
export { AgentDO } from "../src/agent/agent-do"

const spin = (ms: number) => {
  // Date.now() does not advance inside a Worker's synchronous code, so loop a fixed count. ms is millions.
  let n = 0
  for (let i = 0; i < ms * 1_000_000; i++) n += i & 1
  return n
}

// Experiment 4 probe. Burns CPU in a Durable Object to see whether a CPU limit applies there.
export class SpinDO extends DurableObject {
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
    if (url.pathname === "/spin-do") return Response.json({ spun: await env.SPIN.get(env.SPIN.idFromName("spin")).spin(ms), ms })
    return new Response("not found", { status: 404 })
  },
}
