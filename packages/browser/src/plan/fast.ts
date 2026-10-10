import { BROWSER } from "../config"
import type { Choice } from "../decide/types"
import type { Control, PageView } from "../page/types"
import { TEXT_ROLES } from "./candidates"
import { goalWords, rawWords } from "./words"

const flags = (c: Control) => c.state?.split(" ") ?? []

/** Label words, with adjacent pairs joined so "E-mail" matches a value named email. */
const labelWords = (label: string) => {
  const raw = rawWords(label)
  return new Set([...raw, ...raw.slice(1).map((w, i) => raw[i] + w)])
}

/**
 * Steps so certain that no decider is asked. Only fills, never a click:
 * - a value whose name's words all appear in exactly one empty field's label, and that field matches no other name;
 * - or, for a goal that says search, the one value into the one empty field on the page, when that field is a search box.
 * A tie of any kind gives no fast step. Fills run in page order, at most chainMax; a search submit runs alone.
 */
export function fastSteps(page: PageView, goal: string, values: Record<string, string>, options: Choice[]): Choice[] {
  const names = Object.keys(values)
  if (names.length === 0) return []
  const fields = page.controls.filter((c) => TEXT_ROLES.has(c.role) && !c.value && !flags(c).includes("secret") && !flags(c).includes("disabled"))
  const option = (id: number, n: number) => options.find((o) => o.key === `t${id}v${n}`)
  if (names.length === 1 && fields.length === 1 && goalWords(goal).includes("search")) {
    const only = option((fields[0] as Control).id, 0)
    if (only?.step.op === "type" && only.step.submit) return [only]
  }
  const words = fields.map((f) => labelWords(f.label))
  const fits = (n: number, i: number) => {
    const need = rawWords(names[n] as string)
    return need.length > 0 && need.every((w) => words[i]?.has(w))
  }
  const out: Choice[] = []
  for (const [i, field] of fields.entries()) {
    const matches = names.map((_, n) => n).filter((n) => fits(n, i))
    if (matches.length !== 1) continue
    const n = matches[0] as number
    if (fields.filter((_, j) => fits(n, j)).length !== 1) continue
    const o = option(field.id, n)
    if (o?.step.op === "type" && !o.step.submit) out.push(o)
  }
  return out.slice(0, BROWSER.chainMax)
}
