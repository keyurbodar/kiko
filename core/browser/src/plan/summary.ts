import { BROWSER } from "../config"
import type { PageView } from "../page/types"
import { passages } from "./rank"
import { goalWords, rawWords } from "./words"

// ranked replaces the lexical passages used for find.
export function summarize(page: PageView, find?: string, ranked?: string): string {
  const words = find ? goalWords(find) : []
  const score = (i: number) => {
    const c = page.controls[i]
    const bag = new Set(rawWords(`${c.label} ${c.hint ?? ""}`))
    return words.reduce((n, w) => n + (bag.has(w) ? 1 : 0), 0)
  }
  const order = page.controls.map((_, i) => i)
  if (words.length) order.sort((a, b) => score(b) - score(a) || a - b)
  const shown = order.slice(0, BROWSER.summaryControls).sort((a, b) => a - b)
  const lines = shown.map((i) => {
    const c = page.controls[i]
    return `${c.id} ${c.role} "${c.label}"`
  })
  const hidden = page.controls.length - shown.length + page.omitted
  const text = ranked ?? (find ? passages(page.text, find, 5) : page.text.slice(0, BROWSER.summaryText))
  return [page.title, page.url, ...lines, ...(hidden > 0 ? [`(${hidden} more controls)`] : []), text.slice(0, BROWSER.summaryText)].join("\n")
}
