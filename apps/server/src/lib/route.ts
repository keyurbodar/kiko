import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { originAllowed } from "../router"

export const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function signedIn(request: Request, env: Env): Promise<{ id: string } | Response> {
  if (!originAllowed(request, new URL(request.url), env)) return error(403, "forbidden origin")
  return (await getSessionUser(request, env)) ?? error(401, "unauthorized")
}
