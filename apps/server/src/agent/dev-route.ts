import { isRoomId } from "@kiko/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { agentStub } from "../lib/names"
import { DEFAULT_AGENT } from "../room/room-do"

// DEVELOPMENT ONLY. The verify suite `mid-run` (P1-12) asks for the scripted fake agent of
// `dev-fake.ts` in one of the session user's rooms, so it spends no tokens.
//
//   POST /api/dev/agent/fake  { roomId }  -> { ok: true }
//   GET  /api/dev/agent/children?roomId=   -> { children: [{ id, taskId }] }   (P6-05, `verify subagent`)
//
// A production build answers 404, and so does any host but localhost.

declare const process: { env: { NODE_ENV?: string } }

const PATH = "/api/dev/agent/fake"
const CHILDREN = "/api/dev/agent/children"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export async function devAgentRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== PATH && url.pathname !== CHILDREN) return null
  if (process.env.NODE_ENV !== "development" || !LOCAL_HOSTS.has(url.hostname)) return Response.json({ error: "not found" }, { status: 404 })
  if (url.pathname === CHILDREN) {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    const roomId = url.searchParams.get("roomId") ?? ""
    if (!isRoomId(roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
    return Response.json({ children: await agentStub(env.AGENT, user.id, roomId, DEFAULT_AGENT).devChildren() })
  }
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { roomId?: unknown } | null
  if (typeof body?.roomId !== "string" || !isRoomId(body.roomId)) return Response.json({ error: "bad room id" }, { status: 400 })
  await agentStub(env.AGENT, user.id, body.roomId, DEFAULT_AGENT).devFake()
  return Response.json({ ok: true })
}
