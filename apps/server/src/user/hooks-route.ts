import type { Env } from "../index"
import { userStub } from "../lib/names"
import { sha256Hex } from "@yuki/durable/hash"

// Architecture section 25.4. `POST /api/hooks/<token>` runs the webhook routine the token belongs to.
// There is no session: the Worker finds the user and the routine from the token's SHA-256 in D1, a
// row only UserDO writes when the human's routine is made (DEVIATION D9). The Worker hashes and reads
// one row; it parses nothing, so a webhook stays far inside the Free plan's CPU.

const PATH = /^\/api\/hooks\/([0-9a-f]{48})$/
/** The largest body a hook takes. */
export const MAX_HOOK_BYTES = 64 * 1024

const answer = (status: number, body: Record<string, unknown>) => Response.json(body, { status })

export async function hooksRoute(request: Request, env: Env): Promise<Response | null> {
  const token = PATH.exec(new URL(request.url).pathname)?.[1]
  if (!token) return null
  if (request.method !== "POST") return answer(405, { error: "method not allowed" })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_HOOK_BYTES) return answer(413, { error: "the body is larger than 64 kb" })
  const body = await readCapped(request, MAX_HOOK_BYTES)
  if (body === null) return answer(413, { error: "the body is larger than 64 kb" })
  const row = await env.AUTH_DB.prepare('select "user_id", "routine_id" from "hooks" where "token_hash" = ?').bind(await sha256Hex(token)).first<{ user_id: string; routine_id: string }>()
  if (!row) return answer(404, { error: "no such hook" })
  // A sender's own delivery id makes a retried post run once. Without one, the same body in the same
  // minute is the same post; a sender that posts a fixed body on a schedule still runs every time.
  const key = request.headers.get("x-github-delivery") ?? request.headers.get("idempotency-key") ?? request.headers.get("x-request-id") ?? `${(await sha256Hex(body)).slice(0, 32)}:${Math.floor(Date.now() / 60_000)}`
  const status = await userStub(env.USER, row.user_id).routineHook(row.routine_id, token, key.slice(0, 128), body)
  return status === "unknown" ? answer(404, { error: "no such hook" }) : answer(202, { status })
}

/** The body as text, or null past `max` bytes. A chunked post with no length is read only that far. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}
