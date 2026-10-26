import { ReleaseVersion } from "@kiko/protocol"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { Env } from "../index"
import { ownerStub } from "../lib/names"
import { error, signedIn } from "../lib/route"

const UPDATE_PATH = "/api/update"

const decodeStart = Schema.decodeUnknownOption(Schema.Struct({ version: ReleaseVersion }))

export async function updateRoute(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== UPDATE_PATH) return null
  if (request.method !== "GET" && request.method !== "POST") return error(405, "method not allowed")
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
  const owner = ownerStub(env.OWNER, user.id)
  if (request.method === "GET") return Response.json(await owner.updateState())
  const start = decodeStart(await request.json().catch(() => null))
  if (Option.isNone(start)) return error(400, "send the version to update to")
  return Response.json(await owner.updateStart(start.value.version), { status: 202 })
}
