import { type Envelope, isAgentSlug, isRoomId } from "@kiko/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { agentStub } from "../lib/names"
import { DEFAULT_AGENT } from "../room/room-do"

// DEVELOPMENT ONLY. The verify suite `mid-run` (P1-12) asks for the scripted fake agent of
// `dev-fake.ts` in one of the session user's rooms, so it spends no tokens.
//
//   POST /api/dev/agent/fake     { roomId }  -> { ok: true }
//   POST /api/dev/agent/deliver  { roomId, from, body, tainted }  -> { ok: true }
//
// `deliver` hands the room's agent one envelope from teammate `from`, as the room will once agents
// message each other. The suite `injection` (P7-01) uses it for a tainted agent message.
//
// A production build answers 404, and so does any host but localhost.

declare const process: { env: { NODE_ENV?: string } }

const PATH = "/api/dev/agent/fake"
const DELIVER = "/api/dev/agent/deliver"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export async function devAgentRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== PATH && url.pathname !== DELIVER) return null
  if (process.env.NODE_ENV !== "development" || !LOCAL_HOSTS.has(url.hostname)) return Response.json({ error: "not found" }, { status: 404 })
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { roomId?: unknown; from?: unknown; body?: unknown; tainted?: unknown } | null
  if (typeof body?.roomId !== "string" || !isRoomId(body.roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
  const agent = agentStub(env.AGENT, user.id, body.roomId, DEFAULT_AGENT)
  if (url.pathname === DELIVER) {
    if (typeof body.from !== "string" || !isAgentSlug(body.from) || typeof body.body !== "string") {
      return Response.json({ error: "bad envelope" }, { status: 400 })
    }
    const id = crypto.randomUUID()
    const envelope: Envelope = {
      id,
      roomId: body.roomId,
      from: { kind: "agent", slug: body.from },
      body: body.body,
      hop: 1,
      rootId: id,
      tainted: body.tainted === true,
      seq: 0,
    }
    const { refused } = await agent.receive([envelope], "", { userId: user.id, roomId: body.roomId, slug: DEFAULT_AGENT })
    return refused ? Response.json({ error: refused }, { status: 429 }) : Response.json({ ok: true })
  }
  await agent.devFake()
  return Response.json({ ok: true })
}
