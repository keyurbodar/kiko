import { type Envelope, isAgentSlug, isRoomId } from "@kiko/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { agentStub, roomStub, userStub } from "../lib/names"
import { DEFAULT_AGENT } from "../room/room-do"
import { MAX_MEMBERS } from "../room/members"

// DEVELOPMENT ONLY. The verify suites `mid-run` (P1-12) and `team-routing` (P6-01) ask for the
// scripted fake agent of `dev-fake.ts` in one of the session user's rooms, so they spend no tokens.
//
//   POST /api/dev/agent/fake    { roomId, slugs? }  -> { ok: true }   slugs default to [DEFAULT_AGENT]
//   POST /api/dev/agent/status  { roomId, slug }    -> the agent's `status()`: inbox counts and submissions
//   POST /api/dev/agent/limits  { limits }  -> { limits }   the session user's plan record (P9-01)
//   GET  /api/dev/agent/children?roomId=        -> { children: [{ id, taskId }] }   (P6-05, `verify subagent`)
//   POST /api/dev/agent/deliver { roomId, from, body, tainted }  -> { ok: true }
//   POST /api/dev/agent/seed    { roomId, turns: [{ from, text }] }  -> { turns }   (section 13, `verify memory-eval`)
//   POST /api/dev/agent/memory  { roomId }  -> { turns, pending, view }
//   POST /api/dev/agent/classic { roomId }  -> { ok: true }   the room's agent keeps the old transcript (`verify token-cost`)
//   POST /api/dev/agent/usage   { roomId, slug? }  -> { agent, memory }   tokens the agent and memory summaries spent
//
// `seed` writes messages straight into the room's log, with no burst and no run, so a long chat costs
// no tokens to set up. `from` is "human" or an agent slug. `memory` reports the room's log memory.
//
// `deliver` hands the room's agent one envelope from teammate `from`, as the room will once agents
// message each other. The suite `injection` (P7-01) uses it for a tainted agent message.
//
// A production build answers 404, and so does any host but localhost.

declare const process: { env: { NODE_ENV?: string } }

const PREFIX = "/api/dev/agent/"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export async function devAgentRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const action = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : null
  if (!["fake", "status", "children", "deliver", "limits", "seed", "memory", "classic", "usage", "trace"].includes(action ?? "")) return null
  if (process.env.NODE_ENV !== "development" || !LOCAL_HOSTS.has(url.hostname)) return Response.json({ error: "not found" }, { status: 404 })
  // P9-01: set the session user's plan record, so `verify limits` can lower and raise it.
  if (action === "limits") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { limits?: Record<string, unknown> } | null
    return Response.json({ limits: await userStub(env.USER, user.id).setLimits(body?.limits ?? {}) })
  }
  if (action === "children") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const roomId = url.searchParams.get("roomId") ?? ""
    if (!isRoomId(roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
    return Response.json({ children: await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devChildren() })
  }
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { roomId?: unknown; slugs?: unknown; slug?: unknown; from?: unknown; body?: unknown; tainted?: unknown; turns?: unknown } | null
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
  if (action === "usage") {
    const slug = typeof body.slug === "string" && isAgentSlug(body.slug) ? body.slug : DEFAULT_AGENT
    return Response.json({ agent: await agentStub(env.AGENT, user.id, roomId, slug).devUsage(), memory: await userStub(env.USER, user.id).memoryUsage() })
  }
  if (action === "trace") return Response.json(await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devTrace())
  if (action === "classic") {
    await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devClassic()
    return Response.json({ ok: true })
  }
  if (action === "deliver") {
    if (typeof body.from !== "string" || !isAgentSlug(body.from) || typeof body.body !== "string") {
      return Response.json({ error: "bad envelope" }, { status: 400 })
    }
    const id = crypto.randomUUID()
    const envelope: Envelope = {
      id,
      roomId,
      from: { kind: "agent", slug: body.from },
      body: body.body,
      hop: 1,
      rootId: id,
      tainted: body.tainted === true,
      seq: 0,
    }
    const agent = agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT)
    const { refused } = await agent.receive([envelope], "", { userId: user.id, roomId, slug: DEFAULT_AGENT })
    return refused ? Response.json({ error: refused }, { status: 429 }) : Response.json({ ok: true })
  }
  const slugs = action === "status" ? [body.slug] : (body.slugs ?? [DEFAULT_AGENT])
  if (!Array.isArray(slugs) || !slugs.length || slugs.length > MAX_MEMBERS || !slugs.every((s) => typeof s === "string" && isAgentSlug(s))) {
    return Response.json({ error: "bad slugs" }, { status: 400 })
  }
  const agents = (slugs as string[]).map((slug) => agentStub(env.AGENT, user.id, roomId, slug))
  if (action === "status") return Response.json(await agents[0]!.status())
  for (const agent of agents) await agent.devFake()
  return Response.json({ ok: true })
}
