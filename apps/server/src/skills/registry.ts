import { escapeXml } from "@kiko/agent/text"
import { type Frontmatter, parseFrontmatter, SLUG } from "./frontmatter"

export type Skill = {
  name: string
  description: string
  location: string
  disableModelInvocation: boolean
}

const MAX_DESCRIPTION = 1024

export function parseSkill(content: string, folder: string, location: string): Skill | { warning: string } {
  let parsed: Frontmatter
  try {
    parsed = parseFrontmatter(content)
  } catch {
    return { warning: `skill ${folder}: the frontmatter is not valid YAML, skipped` }
  }
  const { frontmatter } = parsed
  const declared = typeof frontmatter.name === "string" ? frontmatter.name.trim() : ""
  if (declared && declared !== folder)
    return { warning: `skill ${declared}: the name must match its folder ${folder}, skipped` }
  const name = declared || folder
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : ""
  if (!description) return { warning: `skill ${name}: description is required, skipped` }
  if (!SLUG.test(name) || name.length > 64)
    return { warning: `skill ${name}: the name must be lowercase words joined by dashes, skipped` }
  return {
    name,
    description: description.slice(0, MAX_DESCRIPTION),
    location,
    disableModelInvocation: frontmatter["disable-model-invocation"] === true,
  }
}

export function resolveSkills(...lists: readonly Skill[][]): Skill[] {
  const out = new Map<string, Skill>()
  for (const list of lists) for (const s of list) if (!out.has(s.name)) out.set(s.name, s)
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const SKILLS_INTRO =
  "A skill holds instructions for one kind of task. When a task matches one, read its location first and follow it. Paths in a skill are relative to its folder. Recipes added to this chat are skills too; the rest are in /kiko/recipes/ and /home/recipes/, and add_recipe sets one up here."

export function formatSkills(skills: readonly Skill[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation)
  return [
    SKILLS_INTRO,
    "<available_skills>",
    ...visible.map(
      (s) =>
        `  <skill><name>${escapeXml(s.name)}</name><description>${escapeXml(s.description)}</description><location>${escapeXml(s.location)}</location></skill>`,
    ),
    "</available_skills>",
  ].join("\n")
}
