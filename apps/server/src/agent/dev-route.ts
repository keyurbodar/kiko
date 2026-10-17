import { isAgentSlug, isRoomId } from "@kiko/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { devRequest } from "../lib/dev-guard"
import { agentStub, roomStub, userStub } from "../lib/names"
import { DEFAULT_AGENT } from "../room/room-do"
import { MAX_MEMBERS } from "../room/members"

const PREFIX = "/api/dev/agent/"

const slugOf = (body: { slug?: unknown } | null) => (typeof body?.slug === "string" && isAgentSlug(body.slug) ? body.slug : DEFAULT_AGENT)

export async function devAgentRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const action = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : null
  if (!["fake", "status", "workers", "seed", "memory", "usage", "trace", "age", "seen", "due", "pending", "policy", "pass", "composio", "browser"].includes(action ?? "")) return null
  if (!devRequest(url)) return Response.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (action === "policy") {
    const body = (await request.json().catch(() => null)) as { policy?: unknown } | null
    if (!body?.policy || typeof body.policy !== "object") return Response.json({ error: "bad policy" }, { status: 400 })
    await userStub(env.USER, user.id).devSetting("memory_policy", JSON.stringify(body.policy))
    return Response.json({ ok: true })
  }
  if (action === "composio") {
    return Response.json({ session: await userStub(env.USER, user.id).devComposioSession() })
  }
  if (action === "due") {
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null
    await userStub(env.USER, user.id).devDue(String(body?.id ?? ""))
    return Response.json({ ok: true })
  }
  if (action === "seen") {
    const body = (await request.json().catch(() => null)) as { ago?: unknown } | null
    await userStub(env.USER, user.id).devSeen(Number(body?.ago ?? 0))
    return Response.json({ ok: true })
  }
  if (action === "browser") {
    const body = (await request.json().catch(() => null)) as { action?: unknown; agentId?: unknown; mode?: unknown; ms?: unknown } | null
    const known = ["lease", "touch", "dead", "age", "reap", "switch", "state"] as const
    const op = known.find((k) => k === body?.action)
    if (!op) return Response.json({ error: "bad action" }, { status: 400 })
    try {
      return Response.json(await userStub(env.USER, user.id).devBrowser({ action: op, agentId: body?.agentId as string, mode: body?.mode === "headful" ? "headful" : "headless", ms: Number(body?.ms ?? 0) }))
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 })
    }
  }
  if (action === "pass") return Response.json(await userStub(env.USER, user.id).devPass())
  if (action === "workers") {
    const roomId = url.searchParams.get("roomId") ?? ""
    if (!isRoomId(roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
    return Response.json({ workers: await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devWorkers() })
  }
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 })
  const body = (await request.json().catch(() => null)) as { roomId?: unknown; slugs?: unknown; slug?: unknown; turns?: unknown } | null
  if (typeof body?.roomId !== "string" || !isRoomId(body.roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
  const roomId = body.roomId
  if (action === "seed") {
    const turns = Array.isArray(body.turns) ? (body.turns as { from?: unknown; text?: unknown }[]) : []
    if (!turns.length || turns.length > 5_000 || !turns.every((t) => typeof t.text === "string" && (t.from === "human" || (typeof t.from === "string" && isAgentSlug(t.from))))) {
      return Response.json({ error: "bad turns" }, { status: 400 })
    }
    return Response.json({ turns: await roomStub(env.ROOM, user.id, roomId).devSeed(turns as { from: string; text: string }[]) })
  }
  if (action === "memory") return Response.json(await roomStub(env.ROOM, user.id, roomId).devMemory())
  if (action === "pending") return Response.json({ pending: await roomStub(env.ROOM, user.id, roomId).devAgePending(Number((body as { ms?: unknown }).ms ?? 0)) })
  if (action === "age") return Response.json({ open: await roomStub(env.ROOM, user.id, roomId).devAge(Number((body as { ms?: unknown }).ms ?? 0)) })
  if (action === "usage") {
    const slug = slugOf(body)
    return Response.json({ agent: await agentStub(env.AGENT, user.id, roomId, slug).devUsage(), memory: await userStub(env.USER, user.id).memoryUsage() })
  }
  if (action === "trace") return Response.json(await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devTrace())
  const slugs = action === "status" ? [body.slug] : (body.slugs ?? [DEFAULT_AGENT])
  if (!Array.isArray(slugs) || !slugs.length || slugs.length > MAX_MEMBERS || !slugs.every((s) => typeof s === "string" && isAgentSlug(s))) {
    return Response.json({ error: "bad slugs" }, { status: 400 })
  }
  const agents = (slugs as string[]).map((slug) => agentStub(env.AGENT, user.id, roomId, slug))
  const [first] = agents
  if (action === "status" && first) return Response.json(await first.status())
  for (const agent of agents) await agent.devFake()
  return Response.json({ ok: true })
}
