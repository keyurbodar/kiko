import { type Frontmatter, parseFrontmatter } from "./frontmatter"

export type SkillSource = "room" | "recipe" | "builtin"

export type Skill = {
  name: string
  description: string
  body: string
  source: SkillSource
  disableModelInvocation: boolean
}

export const MAX_DESCRIPTION = 1024
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function parseSkill(content: string, fallbackName: string, source: SkillSource): Skill | { warning: string } {
  let parsed: Frontmatter
  try {
    parsed = parseFrontmatter(content)
  } catch {
    return { warning: `skill ${fallbackName}: the frontmatter is not valid YAML, skipped` }
  }
  const { frontmatter, body } = parsed
  const declared = typeof frontmatter.name === "string" ? frontmatter.name.trim() : ""
  if (declared && declared !== fallbackName)
    return { warning: `skill ${declared}: the name must match its folder ${fallbackName}, skipped` }
  const name = declared || fallbackName
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : ""
  if (!description) return { warning: `skill ${name}: description is required, skipped` }
  if (!NAME.test(name) || name.length > 64)
    return { warning: `skill ${name}: the name must be lowercase words joined by dashes, skipped` }
  return {
    name,
    description: description.slice(0, MAX_DESCRIPTION),
    body,
    source,
    disableModelInvocation: frontmatter["disable-model-invocation"] === true,
  }
}

export function resolveSkills(...lists: readonly Skill[][]): Skill[] {
  const out = new Map<string, Skill>()
  for (const list of lists) for (const s of list) if (!out.has(s.name)) out.set(s.name, s)
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")

export function formatSkills(skills: readonly Skill[]): string | undefined {
  const visible = skills.filter((s) => !s.disableModelInvocation)
  if (!visible.length) return undefined
  return [
    "these skills hold instructions for specific tasks. when a task matches one, load it with read_skill(name) first, then follow it.",
    "<available_skills>",
    ...visible.map(
      (s) => `  <skill><name>${escapeXml(s.name)}</name><description>${escapeXml(s.description)}</description></skill>`,
    ),
    "</available_skills>",
  ].join("\n")
}
