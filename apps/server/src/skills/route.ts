import type { SkillList } from "@kiko/protocol"
import type { Env } from "../index"
import { error, signedIn } from "../lib/route"
import { builtinSkills } from "./builtin"
import { resolveSkills } from "./registry"

export async function skillsRoute(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/skills") return null
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
  if (request.method !== "GET") return error(405, "method not allowed")
  const skills = resolveSkills(builtinSkills()).map((s) => ({ name: s.name, description: s.description, source: s.source, disableModelInvocation: s.disableModelInvocation }))
  return Response.json({ skills } satisfies SkillList)
}
