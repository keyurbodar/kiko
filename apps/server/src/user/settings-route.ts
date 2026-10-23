import { UserSettingsPatch } from "@kiko/protocol"
import { Schema } from "effect"
import type { Env } from "../index"
import { error, signedIn } from "../lib/route"
import { ownerStub } from "../lib/names"
import { validZone } from "@kiko/sandbox/recurrence"

const decodePatch = Schema.decodeUnknownSync(UserSettingsPatch)

export async function settingsRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== "/api/settings") return null
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
  if (request.method === "POST" && !request.headers.get("content-type")?.includes("application/json"))
    return error(415, "expected json")
  const stub = ownerStub(env.OWNER, user.id)

  if (request.method === "GET") return Response.json(await stub.userCall("userSettings", []))
  if (request.method !== "POST") return error(405, "method not allowed")
  let patch: UserSettingsPatch
  try {
    patch = decodePatch(await request.json().catch(() => null))
  } catch {
    return error(400, "initiative is off, chat, digest or active. capture is auto or off")
  }
  if (patch.timezone !== undefined && !validZone(patch.timezone))
    return error(400, "timezone must be an IANA time zone, such as Europe/Berlin")
  return Response.json(await stub.userCall("setUserSettings", [patch]))
}
