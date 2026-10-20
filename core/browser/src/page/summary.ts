import { BROWSER } from "../config"
import type { Control, PageView } from "./types"

const words = (text: string): string[] => [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))]

const mentions = (text: string, terms: readonly string[]): boolean => {
  const lower = text.toLowerCase()
  return terms.some((term) => lower.includes(term))
}

function findPassages(text: string, find: string, limit: number = BROWSER.textMax): string {
  const terms = words(find)
  if (!terms.length) return text.slice(0, limit)
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, " ").replace(/\n/g, " ").trim())
    .filter(Boolean)
    .filter((p) => mentions(p, terms))
  if (!paragraphs.length) return ""
  const out: string[] = []
  let size = 0
  for (const paragraph of paragraphs) {
    if (size + paragraph.length + 1 > limit) {
      out.push("(more mentions follow; open the page again or use a narrower find)")
      break
    }
    out.push(paragraph)
    size += paragraph.length + 1
  }
  return out.join("\n\n")
}

const controlLine = (control: Control): string => `${control.id} ${control.role} "${control.label}"${control.href ? ` -> ${control.href}` : ""}`

export function summarize(page: PageView, find?: string): string {
  const terms = find ? words(find) : []
  const matching = terms.length ? page.controls.filter((c) => mentions(`${c.label} ${c.hint ?? ""}`, terms)) : page.controls
  const shown = matching.slice(0, BROWSER.summaryControls)
  const lines = shown.map(controlLine)
  if (matching.length > shown.length) lines.push(`(${matching.length - shown.length} more controls)`)
  if (terms.length && !matching.length) lines.push(`(no control mentions ${find})`)
  const text = find ? findPassages(page.text, find) : page.text
  const body = text || (find ? `nothing on this page mentions ${find}` : "(no text on the page)")
  return [page.title, page.url, ...lines, "", body].join("\n")
}
