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
 * Steps so certain that no decider is asked:
 * - a value whose name's words all appear in exactly one empty field's label, and that field matches no other name;
 * - or, for a goal that says search, the one value into the one empty field on the page, when that field is a search box;
 * - or, for a goal that says search on a page with no empty field, a click on the one link or button named exactly Search.
 * A tie of any kind gives no fast step. A value typed once (even if it failed) and a Search control clicked once are
 * the decider's from then on, so the fast path never repeats itself. Fills run in page order, at most chainMax.
 */
export function fastSteps(page: PageView, goal: string, values: Record<string, string>, options: Choice[], history: string[] = []): Choice[] {
  const names = Object.keys(values)
  const fresh = names.map((name) => !history.some((h) => h.includes(` type ${name} into `)))
  if (!fresh.includes(true)) return []
  const fields = page.controls.filter((c) => TEXT_ROLES.has(c.role) && !c.value && !flags(c).includes("secret") && !flags(c).includes("disabled"))
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
