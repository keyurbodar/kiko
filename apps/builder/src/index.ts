import { DurableObject } from "cloudflare:workers"
import { buildCapsule, type Target } from "./build"

type Env = { BUILDER: DurableObjectNamespace<Builder>; BUILDER_SECRET?: string }
type BuildRequest = { files: Record<string, string>; target: Target }

export class Builder extends DurableObject<Env> {
  async build(request: BuildRequest) {
    return buildCapsule(request.files, request.target)
  }
}

function authorized(request: Request, env: Env): boolean {
  return Boolean(env.BUILDER_SECRET) && request.headers.get("authorization") === `Bearer ${env.BUILDER_SECRET}`
}

function parse(body: unknown): BuildRequest | null {
  const value = body as Partial<BuildRequest> | null
  if (!value || typeof value.files !== "object" || value.files === null) return null
  if (value.target !== "anonymous" && value.target !== "claimed") return null
  if (!Object.values(value.files).every((text) => typeof text === "string")) return null
  return { files: value.files, target: value.target }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== "POST" || url.pathname !== "/build") return new Response("not found", { status: 404 })
    if (!authorized(request, env)) return new Response("unauthorized", { status: 401 })
    const input = parse(await request.json().catch(() => null))
    if (!input) return Response.json({ error: "Send { files, target: anonymous | claimed }." }, { status: 400 })
    const builder = env.BUILDER.get(env.BUILDER.idFromName("builder"))
    return Response.json(await builder.build(input))
  },
} satisfies ExportedHandler<Env>
