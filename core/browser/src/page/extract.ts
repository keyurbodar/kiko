import { evaluate, flush, type PageState } from "./read"
import type { Dialog, EvalResult, ExtractKind } from "./types"

const TEXT_MAX = 12_000
const EVAL_MAX = 4_000
const LINKS_MAX = 60
const TABLES_MAX = 3
const ROWS_MAX = 30
const HEADINGS_MAX = 60
const FORMS_MAX = 5
const FIELDS_MAX = 40

export type Table = { header: string[] | null; rows: string[][]; moreRows: number }
export type Field = { id: number | null; kind: string; label: string; value: string }
export type Form = { action: string; method: string; fields: Field[]; moreFields: number }

const blocked = (dialog: Dialog) => `a ${dialog.type} dialog says: ${dialog.message}. Answer it before reading the page.`

export function formatLinks(raw: [string, string][]): string {
  if (raw.length === 0) return "no links"
  return raw.map(([text, href]) => `${text} -> ${href}`).join("\n")
}

export function formatTables(raw: { tables: Table[]; more: number }): string {
  if (raw.tables.length === 0) return "no tables"
  const lines: string[] = []
  raw.tables.forEach((table, i) => {
    lines.push(`table ${i + 1}`)
    if (table.header) lines.push(table.header.join("|"))
    for (const row of table.rows) lines.push(row.join("|"))
    if (table.moreRows > 0) lines.push(`...${table.moreRows} more rows`)
  })
  if (raw.more > 0) lines.push(`...${raw.more} more tables`)
  return lines.join("\n")
}

export function formatForms(forms: Form[], more: number): string {
  if (forms.length === 0) return "no forms"
  const lines: string[] = []
  forms.forEach((form, i) => {
    lines.push(`form ${i + 1} ${form.method.toUpperCase()} ${form.action}`.trimEnd())
    for (const field of form.fields) {
      const id = field.id === null ? "-" : `[${field.id}]`
      lines.push(`  ${id} ${field.label} (${field.kind})${field.value ? ` = ${field.value}` : ""}`)
    }
    if (form.moreFields > 0) lines.push(`  ...${form.moreFields} more fields`)
  })
  if (more > 0) lines.push(`...${more} more forms`)
  return lines.join("\n")
}

export function formatHeadings(raw: [number, string][]): string {
  if (raw.length === 0) return "no headings"
  return raw.map(([level, text]) => `h${level} ${text}`).join("\n")
}

export function formatAllText(raw: string): string {
  const text = raw
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, TEXT_MAX)
  return text === "" ? "no visible text" : text
}

const LINKS_SCRIPT = `(() => {
  const out = []
  for (const a of document.querySelectorAll("a[href]")) {
    if (a.getClientRects().length === 0 || a.href.startsWith("javascript:")) continue
    const text = (a.innerText || a.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim()
    if (text === "") continue
    out.push([text, a.href])
    if (out.length === ${LINKS_MAX}) break
  }
  return JSON.stringify(out)
})()`

const TABLES_SCRIPT = `(() => {
  const clean = (s) => s.replace(/\\s+/g, " ").trim().replace(/\\|/g, "/")
  const tables = []
  let more = 0
  for (const t of document.querySelectorAll("table")) {
    if (t.getClientRects().length === 0) continue
    if (tables.length === ${TABLES_MAX}) {
      more++
      continue
    }
    const all = Array.from(t.rows)
    const cells = all.map((r) => Array.from(r.cells).map((c) => clean(c.innerText)))
    const hasHeader = all.length > 0 && all[0].cells.length > 0 && all[0].cells[0].tagName === "TH"
    const body = cells.slice(hasHeader ? 1 : 0).filter((r) => r.some((c) => c !== ""))
    tables.push({ header: hasHeader ? cells[0] : null, rows: body.slice(0, ${ROWS_MAX}), moreRows: Math.max(0, body.length - ${ROWS_MAX}) })
  }
  return JSON.stringify({ tables, more })
})()`

const FORMS_SCRIPT = `(() => {
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim()
  const ids = new Map()
  const registry = window.__kiko && window.__kiko.els
  if (registry) for (const [id, ref] of registry) {
    const el = ref.deref && ref.deref()
    if (el) ids.set(el, id)
  }
  const forms = []
  for (const f of Array.from(document.forms).slice(0, ${FORMS_MAX})) {
    const fields = []
    for (const el of Array.from(f.elements)) {
      const tag = el.tagName
      const type = (el.type || "").toLowerCase()
      if (type === "hidden" || el.getClientRects().length === 0) continue
      const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null
      const label = clean(el.getAttribute("aria-label") || (byFor ? byFor.innerText : "") || el.placeholder || el.name || (tag === "BUTTON" ? el.innerText || el.value : ""))
      const kind = tag === "SELECT" ? "select" : tag === "TEXTAREA" ? "textarea" : tag === "BUTTON" ? "button" : type || "text"
      const value = type === "password" ? (el.value ? "(set)" : "") : type === "checkbox" || type === "radio" ? (el.checked ? "checked" : "") : clean(el.value)
      fields.push({ id: ids.get(el) ?? null, kind, label, value })
    }
    forms.push({ action: f.getAttribute("action") || "", method: f.method || "get", fields: fields.slice(0, ${FIELDS_MAX}), moreFields: Math.max(0, fields.length - ${FIELDS_MAX}) })
  }
  return JSON.stringify({ forms, more: Math.max(0, document.forms.length - ${FORMS_MAX}) })
})()`

const HEADINGS_SCRIPT = `(() => {
  const out = []
  for (const h of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (h.getClientRects().length === 0) continue
    const text = h.innerText.replace(/\\s+/g, " ").trim()
    if (text === "") continue
    out.push([Number(h.tagName.charAt(1)), text])
    if (out.length === ${HEADINGS_MAX}) break
  }
  return JSON.stringify(out)
})()`

const ALL_TEXT_SCRIPT = `(() => (document.body ? document.body.innerText : ""))()`

export async function extract(page: PageState, kind: ExtractKind): Promise<string> {
  if (page.dialog) return blocked(page.dialog)
  await flush(page)
  switch (kind) {
    case "links":
      return formatLinks(JSON.parse(await evaluate<string>(page, LINKS_SCRIPT)))
    case "tables":
      return formatTables(JSON.parse(await evaluate<string>(page, TABLES_SCRIPT)))
    case "forms": {
      const raw = JSON.parse(await evaluate<string>(page, FORMS_SCRIPT)) as { forms: Form[]; more: number }
      return formatForms(raw.forms, raw.more)
    }
    case "headings":
      return formatHeadings(JSON.parse(await evaluate<string>(page, HEADINGS_SCRIPT)))
    case "all_text":
      return formatAllText(await evaluate<string>(page, ALL_TEXT_SCRIPT))
  }
}

export async function evaluateExpression(page: PageState, expression: string): Promise<EvalResult> {
  if (page.dialog) return { ok: false, error: blocked(page.dialog) }
  await flush(page)
  const wrapped = `(async () => { const v = await (${expression}\n); const s = JSON.stringify(v); return s === undefined ? "undefined" : s.slice(0, ${EVAL_MAX}) })()`
  const out = await page.channel.send("Runtime.evaluate", { expression: wrapped, returnByValue: true, awaitPromise: true })
  if (out.exceptionDetails) return { ok: false, error: out.exceptionDetails.exception?.description ?? out.exceptionDetails.text }
  return { ok: true, value: String(out.result.value) }
}
