import type { Env } from "../index"
import { ownerStub } from "../lib/names"
import { error, signedIn } from "../lib/route"
import { BACKEND } from "../lib/version"

/** The revision a client's `If-None-Match` holds, when it was made by this build. The catalog also depends on the bundled pi-ai data, which changes with the version. */
function heldRevision(header: string | null): string | null {
  const tag = header?.replace(/^W\//, "").replace(/^"|"$/g, "")
  const dash = tag?.indexOf("-") ?? -1
  return tag && dash >= 0 && tag.slice(dash + 1) === BACKEND.version ? tag.slice(0, dash) : null
}

export async function modelsRoute(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/models") return null
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
  if (request.method !== "GET") return error(405, "method not allowed")
  const { revision, json } = await ownerStub(env.OWNER, user.id).modelCatalog(heldRevision(request.headers.get("if-none-match")))
  const headers = { etag: `"${revision}-${BACKEND.version}"`, "cache-control": "no-cache" }
  if (json === null) return new Response(null, { status: 304, headers })
  return new Response(json, { headers: { ...headers, "content-type": "application/json" } })
}
