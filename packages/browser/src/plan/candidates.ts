import { BROWSER } from "../config"
import type { Choice } from "../decide/types"
import type { Control, PageView } from "../page/types"
import { goalWords, rawWords } from "./words"

// An ARIA combobox is an editable box with suggestions (Wikipedia's search). A native <select> reads as "select".
const TEXT_ROLES = new Set(["textbox", "searchbox", "textarea", "input", "combobox"])
const SELECT_ROLES = new Set(["select", "listbox"])
const LABEL_MAX = 60
// A needs-value option for at most this many fields, only when the task gave no values.
const ASK_FIELDS = 2

const clip = (s: string) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s)
const hintOf = (c: Control, nav: boolean) => {
  const marks = [c.hint ?? (nav ? "top nav" : ""), filled(c)].filter(Boolean)
  return marks.length ? ` (${marks.join(", ")})` : ""
}
/** Whether a field already holds something, never what: values do not go to a decider. */
const filled = (c: Control) => {
  const f = c.state?.split(" ") ?? []
  if (f.includes("checked")) return "checked"
  return c.value && (TEXT_ROLES.has(c.role) || SELECT_ROLES.has(c.role)) ? "filled" : ""
}

/** Weighted word overlap. A word that few controls carry counts more than one every control carries. */
function scoreControls(page: PageView, goal: string): number[] {
  const words = goalWords(goal)
  const bags = page.controls.map((c) => new Set(rawWords(`${c.label} ${c.hint ?? ""}`)))
  const weight = new Map<string, number>()
  for (const w of words) {
    const df = bags.reduce((n, b) => n + (b.has(w) ? 1 : 0), 0)
    weight.set(w, df === 0 ? 0 : Math.log(1 + bags.length / df))
  }
  return bags.map((b) => words.reduce((s, w) => s + (b.has(w) ? (weight.get(w) ?? 0) : 0), 0))
}

export function keep(page: PageView, goal: string, max: number = BROWSER.candidates): { control: Control; nav: boolean }[] {
  const cs = page.controls
  // Ranking only matters over budget. Under it, a field whose label shares no goal word ("E-mail") stays.
  if (cs.length <= max) {
    let links = 0
    return cs.map((control) => ({ control, nav: control.role === "link" && links++ < BROWSER.navKept }))
  }
  const nav = new Set<number>()
  for (let i = 0; i < cs.length && nav.size < BROWSER.navKept; i++) if (cs[i].role === "link") nav.add(i)
  const scores = scoreControls(page, goal)
  const chosen = new Set(nav)
  const ranked = cs
    .map((_, i) => i)
    .filter((i) => !nav.has(i) && scores[i] > 0)
    .sort((a, b) => scores[b] - scores[a] || a - b)
  for (const i of ranked) if (chosen.size < max) chosen.add(i)
  // Nothing matched (a page in another language): fall back to reading order.
  if (ranked.length === 0) for (let i = 0; i < cs.length && chosen.size < max; i++) chosen.add(i)
  return [...chosen]
    .sort((a, b) => a - b)
    .map((i) => ({ control: cs[i], nav: nav.has(i) }))
}

export function choices(page: PageView, goal: string, values: Record<string, string>): Choice[] {
  const names = Object.keys(values)
  const out: Choice[] = []
  let asked = 0
  for (const { control: c, nav } of keep(page, goal)) {
    if (c.state?.split(" ").includes("secret")) continue
    const label = clip(c.label)
    const tail = hintOf(c, nav)
    if (TEXT_ROLES.has(c.role)) {
      const submit = c.role === "searchbox" || /search/i.test(c.label)
      for (const [n, name] of names.entries()) {
        out.push({
          key: `t${c.id}v${n}`,
          text: `${c.id} type ${name} into ${c.role} "${label}"${tail}`,
          step: { op: "type", id: c.id, text: values[name], submit },
        })
      }
      if (names.length === 0 && asked < ASK_FIELDS) {
        asked++
        // Empty text is the signal the worker reads as "needs_value".
        out.push({ key: `t${c.id}`, text: `${c.id} type text into ${c.role} "${label}"${tail}`, step: { op: "type", id: c.id, text: "" } })
      }
    } else if (SELECT_ROLES.has(c.role)) {
      for (const [n, name] of names.entries()) {
        out.push({
          key: `s${c.id}v${n}`,
          text: `${c.id} select ${name} in ${c.role} "${label}"${tail}`,
          step: { op: "select", id: c.id, option: values[name] },
        })
      }
    } else {
      out.push({ key: `k${c.id}`, text: `${c.id} click ${c.role} "${label}"${tail}`, step: { op: "click", id: c.id } })
    }
  }
  out.push({ key: "sd", text: "scroll down", step: { op: "scroll", direction: "down" } })
  out.push({ key: "done", text: "done", step: { op: "done" } })
  out.push({ key: "stuck", text: "stuck", step: { op: "stuck" } })
  return out
}
