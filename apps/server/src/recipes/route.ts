import type { InstallRecipe, RecipeList } from "@kiko/protocol"
import { isAgentSlug, isRoomId } from "@kiko/protocol"
import type { Env } from "../index"
import { userStub } from "../lib/names"
import { error, signedIn } from "../lib/route"
import { SLUG } from "./recipe"

const ID = /^[0-9a-f-]{36}$/
const INSTALL = /^\/api\/recipes\/([0-9a-f-]{36})$/
const EDIT = /^\/api\/recipes\/([^/]+)\/edit$/

function parseInstall(b: unknown): InstallRecipe | null {
  if (!b || typeof b !== "object") return null
  const o = b as Record<string, unknown>
  if (typeof o.installId !== "string" || !ID.test(o.installId) || typeof o.slug !== "string" || !o.slug) return null
  if (o.own === true) return { installId: o.installId, slug: o.slug, own: true }
  if (typeof o.roomId !== "string" || !isRoomId(o.roomId) || typeof o.agent !== "string" || !isAgentSlug(o.agent)) return null
  return { installId: o.installId, slug: o.slug, roomId: o.roomId, agent: o.agent }
}

export async function recipesRoute(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const one = INSTALL.exec(pathname)
  const edit = EDIT.exec(pathname)
  if (pathname !== "/api/recipes" && !one && !edit) return null
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
  const stub = userStub(env.USER, user.id)
  if (edit) {
    if (request.method !== "POST") return error(405, "method not allowed")
    const slug = edit[1] ?? ""
    if (!SLUG.test(slug) || slug.length > 64) return error(400, "name must be lowercase words joined by dashes")
    const path = await stub.editRecipe(slug)
    return path ? Response.json({ path }) : error(404, `no built-in recipe named ${slug}`)
  }
  if (one) {
    if (request.method !== "DELETE") return error(405, "method not allowed")
    return (await stub.uninstallRecipe(one[1] ?? "")) ? Response.json({ ok: true }) : error(404, "no such install")
  }
  if (request.method === "GET") return Response.json((await stub.recipeList()) satisfies RecipeList)
  if (request.method !== "POST") return error(405, "method not allowed")
  const input = parseInstall(await request.json().catch(() => null))
  if (!input) return error(400, "need installId, slug, and roomId with agent, or own")
  const out = await stub.installRecipe(user.id, input)
  return out.ok ? Response.json({ install: out.install }) : error(400, out.error)
}
