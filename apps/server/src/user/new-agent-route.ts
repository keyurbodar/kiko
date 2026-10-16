import { isAgentSlug, isRoomId } from "@kiko/protocol"
import type { Env } from "../index"
import { userStub } from "../lib/names"
import { error, signedIn } from "../lib/route"

const ID = /^[0-9a-f-]{36}$/
const MAX_NAME = 60
const MAX_DESCRIPTION = 500

/** `POST /api/agents`: makes an agent and its own chat from the new agent form. The client names the agent and the chat, so it opens the chat before this answers. */
export async function newAgentRoute(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/agents") return null
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
  if (request.method !== "POST") return error(405, "method not allowed")
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof b?.name === "string" ? b.name.trim() : ""
  const handle = typeof b?.handle === "string" ? b.handle.trim().toLowerCase() : ""
  const description = typeof b?.description === "string" ? b.description.trim() : ""
  if (!b || typeof b.id !== "string" || !ID.test(b.id) || typeof b.roomId !== "string" || !isRoomId(b.roomId)) return error(400, "need an id and a roomId")
  if (!name || name.length > MAX_NAME) return error(400, `the name is 1 to ${MAX_NAME} characters`)
  if (!isAgentSlug(handle)) return error(400, `"${handle}" is not a usable handle: lowercase letters, digits, and dashes`)
  if (!description || description.length > MAX_DESCRIPTION) return error(400, `the description is 1 to ${MAX_DESCRIPTION} characters`)
  const out = await userStub(env.USER, user.id).createAgentChat({ id: b.id, roomId: b.roomId, name, handle, description })
  return out.ok ? Response.json({ agent: out.agent, roomId: out.roomId }) : error(409, out.error)
}
