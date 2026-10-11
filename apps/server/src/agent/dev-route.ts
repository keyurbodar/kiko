import { isAgentSlug, isRoomId } from "@yuki/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { agentStub, roomStub, userStub } from "../lib/names"
import { DEFAULT_AGENT } from "../room/room-do"
import { MAX_MEMBERS } from "../room/members"

declare const process: { env: { NODE_ENV?: string } }

const PREFIX = "/api/dev/agent/"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export async function devAgentRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const action = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : null
  if (!["fake", "status", "workers", "limits", "seed", "memory", "classic", "usage", "trace", "budget", "age", "seen", "due", "pending", "policy", "loops", "quiet", "initiative", "attention", "composio", "browser"].includes(action ?? "")) return null
  if (process.env.NODE_ENV !== "development" || !LOCAL_HOSTS.has(url.hostname)) return Response.json({ error: "not found" }, { status: 404 })
  if (action === "limits") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { limits?: Record<string, unknown> } | null
    return Response.json({ limits: await userStub(env.USER, user.id).setLimits(body?.limits ?? {}) })
  }
  if (action === "policy") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { policy?: unknown } | null
    if (!body?.policy || typeof body.policy !== "object") return Response.json({ error: "bad policy" }, { status: 400 })
    await userStub(env.USER, user.id).devSetting("memory_policy", JSON.stringify(body.policy))
    return Response.json({ ok: true })
  }
  if (action === "composio") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    return Response.json({ session: await userStub(env.USER, user.id).devComposioSession() })
  }
  if (action === "due") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null
    await userStub(env.USER, user.id).devDue(String(body?.id ?? ""))
    return Response.json({ ok: true })
  }
  if (action === "seen") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { ago?: unknown } | null
    await userStub(env.USER, user.id).devSeen(Number(body?.ago ?? 0))
    return Response.json({ ok: true })
  }
  if (action === "browser") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
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
  if (action === "attention") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { action?: unknown; ms?: unknown; mode?: unknown } | null
    const op =
      body?.action === "age"
        ? ({ action: "age", ms: Number(body.ms ?? 0) } as const)
        : body?.action === "rhythm"
          ? ({ action: "rhythm", mode: body.mode === "clear" ? "clear" : "now" } as const)
          : body?.action === "pass"
            ? ({ action: "pass" } as const)
            : ({ action: "state" } as const)
    return Response.json(await userStub(env.USER, user.id).devInitiative(op))
  }
  if (action === "loops") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { open?: { roomId?: unknown; text?: unknown; due?: unknown } } | null
    const open = body?.open
    if (open && typeof open.roomId === "string" && isRoomId(open.roomId) && typeof open.text === "string") {
      await userStub(env.USER, user.id).loopOpen("human", open.roomId, "", { kind: "intention", certainty: "explicit", text: open.text, due: typeof open.due === "string" ? open.due : null })
    }
    return Response.json({ loops: await userStub(env.USER, user.id).loopList({ status: ["open", "done", "dropped", "snoozed"], limit: 200 }) })
  }
  if (action === "workers") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const roomId = url.searchParams.get("roomId") ?? ""
    if (!isRoomId(roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
    return Response.json({ workers: await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devWorkers() })
  }
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
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
  if (action === "quiet") {
    await roomStub(env.ROOM, user.id, roomId).devQuiet()
    return Response.json({ ok: true })
  }
  if (action === "memory") return Response.json(await roomStub(env.ROOM, user.id, roomId).devMemory())
  if (action === "pending") return Response.json({ pending: await roomStub(env.ROOM, user.id, roomId).devAgePending(Number((body as { ms?: unknown }).ms ?? 0)) })
  if (action === "age") return Response.json({ open: await roomStub(env.ROOM, user.id, roomId).devAge(Number((body as { ms?: unknown }).ms ?? 0)) })
  if (action === "budget") {
    const slug = typeof body.slug === "string" && isAgentSlug(body.slug) ? body.slug : DEFAULT_AGENT
    await agentStub(env.AGENT, user.id, roomId, slug).devBudget(Number((body as { ms?: unknown }).ms ?? 0))
    return Response.json({ ok: true })
  }
  if (action === "usage") {
    const slug = typeof body.slug === "string" && isAgentSlug(body.slug) ? body.slug : DEFAULT_AGENT
    return Response.json({ agent: await agentStub(env.AGENT, user.id, roomId, slug).devUsage(), memory: await userStub(env.USER, user.id).memoryUsage() })
  }
  if (action === "initiative") {
    const slug = typeof body.slug === "string" && isAgentSlug(body.slug) ? body.slug : DEFAULT_AGENT
    return Response.json({ text: await agentStub(env.AGENT, user.id, roomId, slug).devInitiative() })
  }
  if (action === "trace") return Response.json(await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devTrace())
  if (action === "classic") {
    await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devClassic()
    return Response.json({ ok: true })
  }
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
