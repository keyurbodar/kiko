import { BROWSER } from "../config"
import type { Choice } from "../decide/types"
import type { Control, PageView } from "../page/types"
import { TEXT_ROLES, flags } from "./candidates"
import { goalWords, rawWords } from "./words"

/** Label words, with adjacent pairs joined so "E-mail" matches a value named email. */
const labelWords = (label: string) => {
  const raw = rawWords(label)
  return new Set([...raw, ...raw.slice(1).map((w, i) => raw[i] + w)])
}

// A value typed once and a Search click once go to the decider, so the fast path never repeats itself.
export function fastSteps(page: PageView, goal: string, values: Record<string, string>, options: Choice[], history: string[] = []): Choice[] {
  const names = Object.keys(values)
  const fresh = names.map((name) => !history.some((h) => h.includes(` type ${name} into `)))
  if (!fresh.includes(true)) return []
  const fields = page.controls.filter((c) => TEXT_ROLES.has(c.role) && !c.value && !flags(c.state).includes("secret") && !flags(c.state).includes("disabled"))
  const option = (id: number, n: number) => options.find((o) => o.key === `t${id}v${n}`)
  const search = names.length === 1 && goalWords(goal).includes("search")
  if (search && fields.length === 1) {
    const only = option((fields[0] as Control).id, 0)
    return only?.step.op === "type" && only.step.submit ? [only] : []
  }
  if (search && fields.length === 0) {
    // A narrow window folds the search box behind one control named Search (Wikipedia): open it, once.
    if (history.some((h) => / click (link|button) "Search"/.test(h))) return []
    const opener = page.controls.filter((c) => (c.role === "link" || c.role === "button") && c.label.trim().toLowerCase() === "search")
    const open = opener.length === 1 ? options.find((o) => o.key === `k${(opener[0] as Control).id}`) : undefined
    return open ? [open] : []
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
    if (!fresh[n] || fields.filter((_, j) => fits(n, j)).length !== 1) continue
    const o = option(field.id, n)
    if (o?.step.op === "type" && !o.step.submit) out.push(o)
  }
  return out.slice(0, BROWSER.chainMax)
}
