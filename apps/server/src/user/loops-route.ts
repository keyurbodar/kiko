import { LoopAction, UserSettingsPatch } from "@yuki/protocol/schema"
import { isRoomId } from "@yuki/protocol"
import { Schema } from "effect"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { userStub } from "../lib/names"
import { originAllowed } from "../router"

// Architecture section 26. The human's view of their open loops, and the two settings that steer
// initiative. The Worker checks the session and reaches only the session user's `UserDO`.
//
//   GET  /api/loops?room=<id>      the human's open and snoozed loops, optionally one chat's
//   POST /api/loops/<id>           { action: "done" | "drop" } or { action: "snooze", until }
//   GET  /api/settings             { initiative, capture }
//   POST /api/settings             { initiative?, capture? }, each from a fixed list

const ACTION = /^\/api\/loops\/(\d{1,12})$/
const decodeAction = Schema.decodeUnknownSync(LoopAction)
const decodePatch = Schema.decodeUnknownSync(UserSettingsPatch)

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function loopsRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const action = ACTION.exec(url.pathname)
  const settings = url.pathname === "/api/settings"
  if (url.pathname !== "/api/loops" && !action && !settings) return null
  if (!originAllowed(request, url, env)) return error(403, "forbidden origin")
  const user = await getSessionUser(request, env)
  if (!user) return error(401, "unauthorized")
  if (request.method === "POST" && !request.headers.get("content-type")?.includes("application/json")) return error(415, "expected json")
  const stub = userStub(env.USER, user.id)

  if (settings) {
    if (request.method === "GET") return Response.json(await stub.userSettings())
    if (request.method !== "POST") return error(405, "method not allowed")
    try {
      return Response.json(await stub.setUserSettings(decodePatch(await request.json().catch(() => null))))
    } catch {
      return error(400, "initiative is off, chat, digest or active. capture is auto, always or off")
    }
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
  if (body.action === "snooze" && !Number.isFinite(body.until)) return error(400, "bad until")
  return (await stub.loopAct(Number(action[1]), body)) ? Response.json({ ok: true }) : error(404, "no such loop")
}
