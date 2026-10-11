import { isRoomId } from "@yuki/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { DEV } from "../lib/dev-guard"
import { userStub } from "../lib/names"
import type { ReminderResult } from "./reminders"

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

export async function remindersRoute(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const action = ACTION.exec(pathname)
  if (pathname !== "/api/reminders" && !action) return null
  const user = await getSessionUser(request, env)
  if (!user) return error(401, "unauthorized")
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
    if (!DEV) return error(404, "not found")
    return reply(await stub.rewindReminder(id))
  }
  const time = str((await body(request))?.time)
  if (!time) return error(400, "need time")
  return reply(await stub.snoozeReminder(id, time))
}
