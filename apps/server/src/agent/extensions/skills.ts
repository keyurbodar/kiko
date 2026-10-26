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

async function readSkill(fs: RoomFs, file: FsEntry & { kind: "file" }, folder: string): Promise<Skill | null> {
  const bytes = await fs.bytesOf(file, MAX_SKILL_BYTES).catch(() => null)
  if (!bytes) return null
  const skill = parseSkill(new TextDecoder().decode(bytes), folder, `/${file.path}`)
  if (!("warning" in skill)) return skill
  console.warn(skill.warning)
  return null
}

function homeSkillsReader(fs: RoomFs | undefined): () => Promise<Skill[]> {
  const parsed = new Map<string, Promise<Skill | null>>()
  return async () => {
    if (!fs) return []
    const listed = await fs.list(HOME_SKILLS, true)
    if (!listed.ok) return []
    const found = listed.value.map((f) => {
      const folder = f.kind === "file" ? SKILL_FILE.exec(f.path)?.[1] : undefined
      if (!folder || f.kind !== "file") return null
      const key = `${f.path}:${f.sha256}`
      const skill = parsed.get(key) ?? readSkill(fs, f, folder)
      parsed.set(key, skill)
      return skill
    })
    return (await Promise.all(found)).filter((s): s is Skill => s !== null)
  }
}

async function recipeSkills(recipes: RecipesPort | undefined): Promise<Skill[]> {
  if (!recipes) return []
  const listed = await recipes.list().catch(() => [])
  return listed.map((r) => ({ ...r, disableModelInvocation: false }))
}

export function skillsExtension(files?: RoomFs, stamp?: () => number, recipes?: RecipesPort): Extension {
  const homeSkills = homeSkillsReader(files)
  const listed = perRun(async () => formatSkills(resolveSkills(await homeSkills(), await recipeSkills(recipes))), stamp)
  return defineExtension({
    name: SKILLS,
    wraps: [wrapSection(SKILLS, (slot) => ({ ...slot, render: listed }))],
  })
}
