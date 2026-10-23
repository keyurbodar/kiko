import { Schema } from "effect"
import { Calls, type Op } from "@kiko/computer/wire"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { DEV, devRequest } from "../lib/dev-guard"
import { ownerStub } from "../lib/names"

const PATH = "/api/dev/user/computer"

const OPS = Object.keys(Calls) as Op[]
const ACTIONS = ["call", "link", "age", "list", "holder"] as const
type Action = (typeof ACTIONS)[number]

function actionOf(value: unknown): Action | null {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value) ? (value as Action) : null
}

function opOf(value: unknown): Op | null {
  return typeof value === "string" && (OPS as readonly string[]).includes(value) ? (value as Op) : null
}

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

async function run(body: Record<string, unknown>, action: Action, stub: ReturnType<typeof ownerStub>) {
  const pcId = typeof body.pcId === "string" ? body.pcId : ""
  if (!pcId && action !== "list") return bad("pcId is required")
  if (action === "list") return Response.json(await stub.userCall("computerList", []))
  if (action === "holder") return Response.json({ holder: await stub.userCall("computerHolder", [pcId]) })
  if (action === "age")
    return Response.json({ ok: await stub.userCall("devComputerAge", [pcId, Number(body.ms ?? 0)]) })
  if (typeof body.agentId !== "string" || typeof body.roomId !== "string") return bad("agentId and roomId are required")
  if (action === "link") {
    const mode = body.mode === "control" ? "control" : "watch"
    const reason = typeof body.reason === "string" ? body.reason : undefined
    return Response.json(await stub.userCall("computerLink", [body.agentId, body.roomId, pcId, mode, reason]))
  }
  const op = opOf(body.op)
  if (!op) return bad("op is required")
  let args: unknown
  try {
    args = Schema.decodeUnknownSync(Calls[op].args)(body.args ?? {})
  } catch {
    return bad(`bad ${op} args`)
  }
  const deadlineMs = typeof body.deadlineMs === "number" ? body.deadlineMs : undefined
  return Response.json(await stub.userCall("computerCall", [body.agentId, body.roomId, pcId, op, args, deadlineMs]))
}

export async function devComputerRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!DEV || url.pathname !== PATH || request.method !== "POST") return null
  if (!devRequest(url)) return Response.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const action = actionOf(body?.action)
  if (!action) return bad(`action is one of ${ACTIONS.join(", ")}`)
  return run(body ?? {}, action, ownerStub(env.OWNER, user.id))
}
