import { LoopAction, UserSettingsPatch } from "@kiko/protocol/schema"
import { isRoomId } from "@kiko/protocol"
import { Schema } from "effect"
import type { Env } from "../index"
import { error, signedIn } from "../lib/route"
import { userStub } from "../lib/names"
import { SNOOZE_MAX_MS } from "@kiko/memory/loops"
import { validZone } from "@kiko/sandbox/recurrence"

const ACTION = /^\/api\/loops\/(\d{1,12})$/
const decodeAction = Schema.decodeUnknownSync(LoopAction)
const decodePatch = Schema.decodeUnknownSync(UserSettingsPatch)

export async function loopsRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const action = ACTION.exec(url.pathname)
  const settings = url.pathname === "/api/settings"
  if (url.pathname !== "/api/loops" && !action && !settings) return null
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
  if (request.method === "POST" && !request.headers.get("content-type")?.includes("application/json")) return error(415, "expected json")
  const stub = userStub(env.USER, user.id)

  if (settings) {
    if (request.method === "GET") return Response.json(await stub.userSettings())
    if (request.method !== "POST") return error(405, "method not allowed")
    let patch: UserSettingsPatch
    try {
      patch = decodePatch(await request.json().catch(() => null))
    } catch {
      return error(400, "initiative is off, chat, digest or active. capture is auto or off")
    }
    if (patch.timezone !== undefined && !validZone(patch.timezone)) return error(400, "timezone must be an IANA time zone, such as Europe/Berlin")
    return Response.json(await stub.setUserSettings(patch))
  }

  if (!action) {
    if (request.method !== "GET") return error(405, "method not allowed")
    const room = url.searchParams.get("room")
    if (room !== null && !isRoomId(room)) return error(400, "bad room id")
    return Response.json({ loops: await stub.loopsFor(room) })
  }

  if (request.method !== "POST") return error(405, "method not allowed")
  let body: LoopAction
  try {
    body = decodeAction(await request.json().catch(() => null))
  } catch {
    return error(400, "need { action: done | drop } or { action: snooze, until }")
  }
  const now = Date.now()
  if (body.action === "snooze" && !(Number.isFinite(body.until) && body.until > now && body.until <= now + SNOOZE_MAX_MS)) return error(400, "until must be after now and within a year")
  return (await stub.loopAct(Number(action[1]), body)) ? Response.json({ ok: true }) : error(404, "no such loop")
}
