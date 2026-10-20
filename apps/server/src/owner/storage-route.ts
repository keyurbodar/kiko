import type { Env } from "../index"
import { ownerStub } from "../lib/names"
import { error, signedIn } from "../lib/route"

export async function storageRoute(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/storage") return null
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
  if (request.method !== "GET") return error(405, "method not allowed")
  return Response.json(await ownerStub(env.OWNER, user.id).storageUsage())
}
