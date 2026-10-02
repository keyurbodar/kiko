import { parseFrontmatter } from "./frontmatter"

// Architecture section 15, P5-08. A skill is a SKILL.md: frontmatter with `name`, `description`, and
// `disable-model-invocation`, then the instructions. The prompt lists name and description; the
// agent loads the body with read_skill when a task matches. Room skills win over user skills, which
// win over built-in ones, by name. As in pi, a skill with no description is skipped with a warning.

export type SkillSource = "room" | "user" | "builtin"

export type Skill = { name: string; description: string; body: string; source: SkillSource; disableModelInvocation: boolean }

/** As in pi's skills spec. */
export const MAX_DESCRIPTION = 1024
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** One SKILL.md, or the warning that skipped it. `fallbackName` is its directory's name. */
export function parseSkill(content: string, fallbackName: string, source: SkillSource): Skill | { warning: string } {
  const { frontmatter, body } = parseFrontmatter(content)
  const name = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : fallbackName
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : ""
  if (!description) return { warning: `skill ${name}: description is required, skipped` }
  if (!NAME.test(name) || name.length > 64) return { warning: `skill ${name}: the name must be lowercase words joined by dashes, skipped` }
  return {
    name,
    description: description.slice(0, MAX_DESCRIPTION),
    body,
    source,
    disableModelInvocation: frontmatter["disable-model-invocation"] === true,
  }
}

/** Every skill by name, the first list that has a name winning. Pass room, then user, then built-in. */
export function resolveSkills(...lists: readonly Skill[][]): Skill[] {
  const out = new Map<string, Skill>()
  for (const list of lists) for (const s of list) if (!out.has(s.name)) out.set(s.name, s)
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")

/** The prompt's skills section, or undefined when no skill is offered to the model. */
export function formatSkills(skills: readonly Skill[]): string | undefined {
  const visible = skills.filter((s) => !s.disableModelInvocation)
  if (!visible.length) return undefined
  return [
    "these skills hold instructions for specific tasks. when a task matches one, load it with read_skill(name) first, then follow it.",
    "<available_skills>",
    ...visible.map((s) => `  <skill><name>${escapeXml(s.name)}</name><description>${escapeXml(s.description)}</description></skill>`),
    "</available_skills>",
  ].join("\n")
}
