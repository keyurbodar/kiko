import { isRoomId } from "@yuki/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { userStub } from "../lib/names"
import type { ReminderResult } from "./reminders"

// The reminders HTTP routes. The Worker checks the session and reaches only the
// session user's `UserDO`. Validation of the fields happens in reminders.ts.
//
//   GET  /api/reminders                list
//   POST /api/reminders                create { text, time, tz, rrule?, roomId, target? }
//   POST /api/reminders/<id>/cancel
//   POST /api/reminders/<id>/snooze    { time }
//   POST /api/reminders/<id>/rewind    development only: replays the last delivery

declare const process: { env: { NODE_ENV?: string } }

const ACTION = /^\/api\/reminders\/([0-9a-f-]{36})\/(cancel|snooze|rewind)$/

const error = (status: number, message: string) => Response.json({ error: message }, { status })

function reply(result: ReminderResult): Response {
  return result.ok ? Response.json(result.reminder) : error(result.error === "no such reminder" ? 404 : 400, result.error)
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json()
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined)

/** Answers `/api/reminders*`. Returns null for every other path. */
export async function remindersRoute(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const action = ACTION.exec(pathname)
  if (pathname !== "/api/reminders" && !action) return null
  const user = await getSessionUser(request, env)
  if (!user) return error(401, "unauthorized")
  // A JSON content type needs a CORS preflight, so another site cannot post here with the cookie.
  if (request.method === "POST" && !request.headers.get("content-type")?.includes("application/json")) {
    return error(415, "expected json")
  }
  const stub = userStub(env.USER, user.id)

  if (!action) {
    if (request.method === "GET") return Response.json(await stub.listReminders())
    if (request.method !== "POST") return error(405, "method not allowed")
    const b = await body(request)
    const roomId = str(b?.roomId)
    const [text, time, tz] = [str(b?.text), str(b?.time), str(b?.tz)]
    if (!b || !roomId || !isRoomId(roomId) || !text || !time || !tz) return error(400, "need text, time, tz, and roomId")
    return reply(
      await stub.createReminder(user.id, { text, time, tz, roomId, rrule: str(b.rrule), target: str(b.target), createdBy: "human" }),
    )
  }

  if (request.method !== "POST") return error(405, "method not allowed")
  const [, id, verb] = action as unknown as [string, string, string]
  if (verb === "cancel") return reply(await stub.cancelReminder(id))
  if (verb === "rewind") {
    if (process.env.NODE_ENV !== "development") return error(404, "not found")
    return reply(await stub.rewindReminder(id))
  }
  const time = str((await body(request))?.time)
  if (!time) return error(400, "need time")
  return reply(await stub.snoozeReminder(id, time))
}
