import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, wrapSection } from "@earendil-works/pi-durable"
import { builtinSkills } from "../../skills/builtin"
import { formatSkills, parseSkill, resolveSkills, type Skill } from "../../skills/registry"
import { declareEffect } from "@kiko/agent/effects"
import type { RoomFs } from "../../files/room-fs"
import { perRun } from "./self"

export const SKILLS = "skills"
const ROOM_PREFIX = "skills"
const MAX_SKILL_BYTES = 64 * 1024

async function roomSkills(fs: RoomFs | undefined): Promise<Skill[]> {
  if (!fs) return []
  const listed = await fs.list(ROOM_PREFIX, true)
  if (!listed.ok) return []
  const out: Skill[] = []
  for (const f of listed.value) {
    const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(f.path)
    if (!m || f.kind !== "file") continue
    const bytes = await fs.bytesOf(f, MAX_SKILL_BYTES).catch(() => null)
    if (!bytes) continue
    const s = parseSkill(new TextDecoder().decode(bytes), m[1] ?? "", "room")
    if ("warning" in s) console.warn(s.warning)
    else out.push(s)
  }
  return out
}

/** The owner's recipes as the user object keeps them: one call lists them, and a body is fetched only when a skill is read. */
export type RecipesPort = {
  list(): Promise<{ name: string; description: string }[]>
  body(name: string): Promise<string | null>
}

async function recipeSkills(recipes: RecipesPort | undefined): Promise<Skill[]> {
  if (!recipes) return []
  const listed = await recipes.list().catch(() => [])
  return listed.map((r) => ({ name: r.name, description: r.description, body: "", source: "recipe" as const, disableModelInvocation: false }))
}

export function skillsExtension(files?: RoomFs, stamp?: () => number, recipes?: RecipesPort): Extension {
  const all = async () => resolveSkills(await roomSkills(files), await recipeSkills(recipes), builtinSkills())
  const listed = perRun(async () => formatSkills(await all()), stamp)
  return defineExtension({
    name: SKILLS,
    wraps: [wrapSection("skills", (slot) => ({ ...slot, render: listed }))],
    tools: [
      declareEffect(
        "read",
        defineTool({
          name: "read_skill",
          description:
            "load a skill's instructions by its name from <available_skills>. follow them for the task. a room skill may name other files in its folder: pass path (like references/api.md) to read one.",
          parameters: Type.Object({ name: Type.String(), path: Type.Optional(Type.String()) }),
          replay: "safe",
          execute: async ({ name, path }) => {
            const skill = (await all()).find((s) => s.name === name.trim())
            if (!skill) return { content: [{ type: "text" as const, text: `no skill named ${name}` }], isError: true }
            if (!path) {
              const body = skill.source === "recipe" ? await recipes?.body(skill.name) : skill.body
              return body ? { content: [{ type: "text" as const, text: body }] } : { content: [{ type: "text" as const, text: `no skill named ${name}` }], isError: true }
            }
            if (skill.source === "builtin" || !files || path.split("/").includes("..")) return { content: [{ type: "text" as const, text: `${skill.name} has no readable file ${path}` }], isError: true }
            const file = await files.readTextFile(`${skill.source === "recipe" ? "home/recipes" : ROOM_PREFIX}/${skill.name}/${path.replace(/^\/+/, "")}`)
            if (!file.ok) return { content: [{ type: "text" as const, text: file.error.message }], isError: true }
            return { content: [{ type: "text" as const, text: file.value }] }
          },
        }),
      ),
    ],
  })
}
