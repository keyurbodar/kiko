import { defineExtension, type Extension, wrapSection } from "@earendil-works/pi-durable"
import { formatSkills, parseSkill, resolveSkills, type Skill } from "../../skills/registry"
import type { FsEntry } from "../../files/file-index"
import type { RoomFs } from "../../files/room-fs"
import { perRun } from "./self"

export const SKILLS = "skills"
const HOME_SKILLS = "home/skills"
const SKILL_FILE = /^home\/skills\/([^/]+)\/SKILL\.md$/
const MAX_SKILL_BYTES = 64 * 1024

export type RecipesPort = {
  list(): Promise<{ name: string; description: string; location: string }[]>
}

type Listed = { skills: Skill[]; skipped: string[] }

async function readSkill(
  fs: RoomFs,
  file: FsEntry & { kind: "file" },
  folder: string,
): Promise<Skill | { skipped: string }> {
  const bytes = await fs.bytesOf(file, MAX_SKILL_BYTES).catch(() => null)
  if (!bytes) return { skipped: `skill ${folder}: it could not be read, skipped` }
  const skill = parseSkill(new TextDecoder().decode(bytes), folder, `/${file.path}`)
  return "warning" in skill ? { skipped: skill.warning } : skill
}

function homeSkillsReader(fs: RoomFs | undefined): () => Promise<Listed> {
  const parsed = new Map<string, Promise<Skill | { skipped: string }>>()
  return async () => {
    if (!fs) return { skills: [], skipped: [] }
    const listed = await fs.list(HOME_SKILLS, true)
    if (!listed.ok) return { skills: [], skipped: [`${HOME_SKILLS} could not be read: ${listed.error.message}`] }
    const found = listed.value.map((f) => {
      const folder = f.kind === "file" ? SKILL_FILE.exec(f.path)?.[1] : undefined
      if (!folder || f.kind !== "file") return null
      const key = `${f.path}:${f.sha256}`
      const skill = parsed.get(key) ?? readSkill(fs, f, folder)
      parsed.set(key, skill)
      return skill
    })
    const resolved = (await Promise.all(found)).filter((s): s is Skill | { skipped: string } => s !== null)
    return {
      skills: resolved.filter((s): s is Skill => !("skipped" in s)),
      skipped: resolved.flatMap((s) => ("skipped" in s ? [s.skipped] : [])),
    }
  }
}

async function recipeSkills(recipes: RecipesPort | undefined): Promise<Listed> {
  if (!recipes) return { skills: [], skipped: [] }
  const listed = await recipes.list().catch(() => null)
  if (!listed) return { skills: [], skipped: ["the recipe skills could not be read"] }
  return { skills: listed.map((r) => ({ ...r, disableModelInvocation: false })), skipped: [] }
}

export function skillsExtension(files?: RoomFs, stamp?: () => number, recipes?: RecipesPort): Extension {
  const homeSkills = homeSkillsReader(files)
  const listed = perRun(async () => {
    const home = await homeSkills()
    const recipe = await recipeSkills(recipes)
    return formatSkills(resolveSkills(home.skills, recipe.skills), [...home.skipped, ...recipe.skipped])
  }, stamp)
  return defineExtension({
    name: SKILLS,
    wraps: [wrapSection(SKILLS, (slot) => ({ ...slot, render: listed }))],
  })
}
