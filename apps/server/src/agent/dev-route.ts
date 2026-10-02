import { type Envelope, isAgentSlug, isRoomId } from "@kiko/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { agentStub } from "../lib/names"
import { DEFAULT_AGENT } from "../room/room-do"
import { MAX_MEMBERS } from "../room/members"

// DEVELOPMENT ONLY. The verify suites `mid-run` (P1-12) and `team-routing` (P6-01) ask for the
// scripted fake agent of `dev-fake.ts` in one of the session user's rooms, so they spend no tokens.
//
//   POST /api/dev/agent/fake    { roomId, slugs? }  -> { ok: true }   slugs default to [DEFAULT_AGENT]
//   POST /api/dev/agent/status  { roomId, slug }    -> the agent's `status()`: inbox counts and submissions
//   GET  /api/dev/agent/children?roomId=        -> { children: [{ id, taskId }] }   (P6-05, `verify subagent`)
//   POST /api/dev/agent/deliver { roomId, from, body, tainted }  -> { ok: true }
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
  if (action !== "fake" && action !== "status" && action !== "children" && action !== "deliver") return null
  if (process.env.NODE_ENV !== "development" || !LOCAL_HOSTS.has(url.hostname)) return Response.json({ error: "not found" }, { status: 404 })
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
  const body = (await request.json().catch(() => null)) as { roomId?: unknown; slugs?: unknown; slug?: unknown; from?: unknown; body?: unknown; tainted?: unknown } | null
  if (typeof body?.roomId !== "string" || !isRoomId(body.roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
  const roomId = body.roomId
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
