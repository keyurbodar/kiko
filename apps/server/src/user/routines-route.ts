import { isAgentSlug, isRoomId } from "@yuki/protocol"
import { Trigger } from "@yuki/protocol/schema"
import { Schema } from "effect"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { userStub } from "../lib/names"
import { originAllowed } from "../router"
import type { RoutineResult } from "./routines"

const ACTION = /^\/api\/routines\/([0-9a-f-]{36})(\/run)?$/
const decodeTrigger = Schema.decodeUnknownSync(Trigger)

const error = (status: number, message: string) => Response.json({ error: message }, { status })
const reply = (r: RoutineResult) => (r.ok ? Response.json({ routine: r.routine, ...(r.token ? { token: r.token } : {}) }) : error(r.error === "no such routine" ? 404 : 400, r.error))

async function json(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await request.json()
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}


export async function routinesRoute(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const action = ACTION.exec(pathname)
  if (pathname !== "/api/routines" && !action) return null
  if (!originAllowed(request, new URL(request.url), env)) return error(403, "forbidden origin")
  const user = await getSessionUser(request, env)
  if (!user) return error(401, "unauthorized")
  if (request.method === "POST" && !request.headers.get("content-type")?.includes("application/json")) return error(415, "expected json")
  const stub = userStub(env.USER, user.id)

  if (!action) {
    if (request.method === "GET") {
      const routines = (await stub.listReminders()).filter((r) => r.trigger)
      return Response.json({ routines, runs: await stub.routineRuns() })
    }
    if (request.method !== "POST") return error(405, "method not allowed")
    const b = await json(request)
    const roomId = typeof b?.roomId === "string" ? b.roomId : ""
    const agent = typeof b?.agent === "string" ? b.agent : "yuki"
    if (!b || !isRoomId(roomId) || !isAgentSlug(agent) || typeof b.name !== "string" || typeof b.instructions !== "string") return error(400, "need roomId, name, instructions, and trigger")
    let trigger: typeof Trigger.Type
    try {
      trigger = decodeTrigger(b.trigger)
    } catch (e) {
      return error(400, `bad trigger: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`)
    }
    const tz = (await stub.timezone()) ?? "UTC"
    return reply(await stub.createRoutine(user.id, { name: b.name, instructions: b.instructions, trigger, tz, roomId, target: agent, createdBy: "human" }))
  }

  if (request.method !== "POST") return error(405, "method not allowed")
  const id = action[1]
  if (id === undefined) return error(400, "need a routine id")
  if (action[2]) return Response.json({ delivery: await stub.runRoutine(id) })
  const b = await json(request)
  if (!b) return error(400, "expected an object")
  let trigger: typeof Trigger.Type | undefined
  if (b.trigger !== undefined) {
    try {
      trigger = decodeTrigger(b.trigger)
    } catch (e) {
      return error(400, `bad trigger: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`)
    }
  }
  const status = b.status === "active" || b.status === "paused" ? b.status : undefined
  return reply(
    await stub.updateRoutine(id, {
      ...(typeof b.name === "string" ? { name: b.name } : {}),
      ...(typeof b.instructions === "string" ? { instructions: b.instructions } : {}),
      ...(trigger ? { trigger } : {}),
      ...(status ? { status } : {}),
    }),
  )
}
