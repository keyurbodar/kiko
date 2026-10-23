import { PRODUCTION_OWNER } from "../auth/auth"
import type { Env } from "../index"
import { ownerStub } from "../lib/names"
import { readCapped } from "../lib/read-capped"
import { sha256Hex } from "@kiko/durable/hash"
const PATH = /^\/api\/hooks\/([0-9a-f]{48})$/
const MAX_HOOK_BYTES = 64 * 1024

const answer = (status: number, body: Record<string, unknown>) => Response.json(body, { status })

export async function hooksRoute(request: Request, env: Env): Promise<Response | null> {
  const token = PATH.exec(new URL(request.url).pathname)?.[1]
  if (!token) return null
  if (request.method !== "POST") return answer(405, { error: "method not allowed" })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_HOOK_BYTES)
    return answer(413, { error: "the body is larger than 64 kb" })
  const body = await readCapped(request, MAX_HOOK_BYTES)
  if (body === null) return answer(413, { error: "the body is larger than 64 kb" })
  const key =
    request.headers.get("x-github-delivery") ??
    request.headers.get("idempotency-key") ??
    request.headers.get("x-request-id") ??
    `${(await sha256Hex(body)).slice(0, 32)}:${Math.floor(Date.now() / 60_000)}`
  const status = await ownerStub(env.OWNER, PRODUCTION_OWNER).userCall("routineHook", [token, key.slice(0, 128), body])
  return status === "unknown" ? answer(404, { error: "no such hook" }) : answer(202, { status })
}
