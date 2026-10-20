import { AGENT_SLUG_PATTERN } from "@kiko/protocol"
import { CHARM_NAMES, FLAVOUR_NAMES, OUTFIT_NAMES } from "@kiko/avatar"
import type { AvatarPins } from "@kiko/theme/look"

export const MAX_NAME = 60
export const MAX_DESCRIPTION = 500

export type Form = { name: string; handle: string; description: string }
export type Taken = readonly { name: string; slug: string }[]
export type Problems = Partial<Record<keyof Form, string>>

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function handleFrom(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "")
}

export function uniqueHandle(base: string, taken: Taken): string {
  const used = new Set(["kiko", ...taken.map((a) => a.slug)])
  if (!base) return ""
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`
    const candidate = `${base.slice(0, 32 - suffix.length).replace(/-+$/, "")}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

export const suggestHandle = (name: string, taken: Taken): string => uniqueHandle(handleFrom(name), taken)

export function problems(form: Form, taken: Taken): Problems {
  const out: Problems = {}
  const name = form.name.trim()
  if (name.length > MAX_NAME) out.name = `Use ${MAX_NAME} characters or fewer`
  else if (name && (same(name, "kiko") || taken.some((a) => same(a.name, name)))) out.name = "An agent already has this name"
  const handle = form.handle.trim().replace(/^@/, "")
  if (handle && !AGENT_SLUG_PATTERN.test(handle)) out.handle = "Use lowercase letters, digits, and dashes"
  else if (handle && (handle === "kiko" || taken.some((a) => a.slug === handle))) out.handle = "This handle is taken"
  if (form.description.length > MAX_DESCRIPTION) out.description = `Use ${MAX_DESCRIPTION} characters or fewer`
  return out
}

export function ready(form: Form, taken: Taken): boolean {
  const handle = form.handle.trim().replace(/^@/, "")
  return form.name.trim() !== "" && handle !== "" && form.description.trim() !== "" && Object.keys(problems(form, taken)).length === 0
}

const pick = <T,>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)]!

export function shufflePins(random: () => number = Math.random): AvatarPins {
  const flavour = pick(FLAVOUR_NAMES, random)
  const roll = random()
  if (roll < 0.35) return { flavour, charm: pick(CHARM_NAMES, random), outfit: "none" }
  if (roll < 0.55) return { flavour, charm: "none", outfit: pick(OUTFIT_NAMES, random) }
  return { flavour, charm: "none", outfit: "none" }
}

export const faceOptions = (random: () => number = Math.random): AvatarPins[] => [{}, ...Array.from({ length: 7 }, () => shufflePins(random))]

export const tidyName = (name: string): string => {
  const n = name.trim()
  return n.charAt(0).toUpperCase() + n.slice(1)
}
