import { triggerProblem } from "@kiko/sandbox/rule"
import { parseFrontmatter } from "../skills/frontmatter"

/** A schedule the recipe starts with. `every` is an RRULE in the owner's time zone; `run` is the routine's instructions. */
type RecipeTrigger = { name: string; every: string; run: string }

export type Recipe = {
  slug: string
  title: string
  description: string
  when: string
  tags: readonly string[]
  apps: readonly string[]
  icon: string | null
  triggers: readonly RecipeTrigger[]
  setup: readonly string[]
  agent: { name: string; handle: string }
  body: string
}

const RECIPE_TAGS = ["mornings", "inbox", "money", "health", "fun", "thinking", "home", "work", "travel"] as const

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const HANDLE = /^[a-z][a-z0-9-]{1,31}$/
const MAX_DESCRIPTION = 140
const MAX_RUN = 2000

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const texts = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim()) ? v.map((x: string) => x.trim()) : v === undefined ? [] : null)

/** Parses `RECIPE.md`. Throws with the reason, so a broken built-in recipe fails the build, not a run. */
export function parseRecipe(content: string, dir: string): Recipe {
  const fail = (why: string): never => {
    throw new Error(`recipe ${dir}: ${why}`)
  }
  const { frontmatter: f, body } = parseFrontmatter(content)
  const slug = text(f.name) || dir
  if (slug !== dir) fail(`name ${slug} must match its folder`)
  if (!SLUG.test(slug) || slug.length > 64) fail("name must be lowercase words joined by dashes")
  const title = text(f.title) || fail("title is required")
  const description = text(f.description) || fail("description is required")
  if (description.length > MAX_DESCRIPTION) fail(`description is longer than ${MAX_DESCRIPTION} characters`)
  const when = text(f.when) || fail("when is required")
  const tags = texts(f.tags) ?? fail("tags must be a list of words")
  const unknown = tags.find((t) => !(RECIPE_TAGS as readonly string[]).includes(t))
  if (unknown) fail(`tag ${unknown} is not one of ${RECIPE_TAGS.join(", ")}`)
  const apps = texts(f.apps) ?? fail("apps must be a list of app names")
  const setup = texts(f.setup) ?? fail("setup must be a list of questions")
  if (setup.length > 3) fail("setup asks at most 3 questions")
  const rawTriggers = f.triggers ?? []
  if (!Array.isArray(rawTriggers)) fail("triggers must be a list")
  const triggers = (rawTriggers as unknown[]).map((t, i): RecipeTrigger => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>
    const every = text(o.every) || fail(`trigger ${i + 1} needs every`)
    const problem = triggerProblem(every)
    if (problem) fail(`trigger ${i + 1}: ${problem}`)
    const run = text(o.run) || fail(`trigger ${i + 1} needs run`)
    if (run.length > MAX_RUN) fail(`trigger ${i + 1} run is longer than ${MAX_RUN} characters`)
    return { name: text(o.name) || title, every, run }
  })
  const a = (f.agent && typeof f.agent === "object" ? f.agent : {}) as Record<string, unknown>
  const agent = { name: text(a.name) || title, handle: text(a.handle) || slug.split("-")[0] || slug }
  if (!HANDLE.test(agent.handle)) fail(`agent handle ${agent.handle} must be 2 to 32 lowercase letters, digits, or dashes`)
  if (!body.trim()) fail("the body holds the instructions and is required")
  return { slug, title, description, when, tags, apps, icon: text(f.icon) || null, triggers, setup, agent, body: body.trim() }
}
