import type { Block, ColumnAlign, Inline, RichText } from "@kiko/protocol"
import isSuspiciousUrl from "../lib/richtext/suspicious"
import { bareFileName, chipLabel, hrefFile, inlineCodeFile, isFileLabel, parentSuffixes, type FileTarget } from "./file-links"

/* The rich text tree as plain element data. `RichText.tsx` renders this and
 * nothing else, so the table test covers the whole tree-to-DOM mapping. No node
 * carries markup: every string is text, and the renderer never sets innerHTML. */
export type RichNode =
  | { kind: "text"; text: string }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "mention"; slug: string }
  /** `bare` is a name, not a path: it shows as code unless the chat has a file of that name. */
  | { kind: "file"; file: FileTarget; label: string; bare?: true }
  | { kind: "masked"; href: string; children: RichNode[] }
  | { kind: "el"; tag: string; attrs: Record<string, string>; children: RichNode[] }

const el = (tag: string, children: RichNode[], attrs: Record<string, string> = {}): RichNode => ({
  kind: "el",
  tag,
  attrs,
  children,
})

const text = (value: string): RichNode => ({ kind: "text", text: value })

/** Only these become links. A file href becomes a chip, and anything else renders as plain text. */
export const safeHref = (href: string): boolean => /^(https?:|mailto:)/i.test(href)

const fileChip = (file: FileTarget): RichNode => ({ kind: "file", file, label: chipLabel(file) })

const plain = (nodes: readonly Inline[]): string =>
  nodes.map((n) => (n.t === "text" || n.t === "code" ? n.text : n.t === "mention" ? `@${n.slug}` : plain(n.children))).join("")

const SHOWN_HOST = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/?#]|$)/i
const EMBEDDED_HOST = /(?:https?:\/\/|\bwww\.)((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/?#\s,;:!?)]|$)/gi
const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, "")

const shownHosts = (label: string): string[] => {
  const whole = SHOWN_HOST.exec(label.trim())?.[1]
  return whole ? [whole] : Array.from(label.matchAll(EMBEDDED_HOST), (m) => m[1]!)
}

export function maskedLink(href: string, label: string): boolean {
  if (!/^https?:/i.test(href)) return false
  if (isSuspiciousUrl(href)) return true
  const real = bareHost(new URL(href).hostname)
  return shownHosts(label).some((shown) => bareHost(shown) !== real)
}

export function inline(node: Inline): RichNode {
  switch (node.t) {
    case "text":
      // The parser spells a hard break as a lone newline. Soft breaks stay inside text and fold to a space.
      return node.text === "\n" ? el("br", []) : text(node.text)
    case "bold":
      return el("strong", node.children.map(inline))
    case "italic":
      return el("em", node.children.map(inline))
    case "strike":
      return el("s", node.children.map(inline))
    case "code": {
      const file = inlineCodeFile(node.text)
      if (file) return fileChip(file)
      const name = bareFileName(node.text)
      if (name) return { kind: "file", file: name, label: chipLabel(name), bare: true }
      return el("code", [text(node.text)], { class: "rich-inline-code" })
    }
    case "mention":
      return { kind: "mention", slug: node.slug }
    case "link": {
      if (!safeHref(node.href)) {
        const file = hrefFile(node.href)
        if (!file) return el("span", node.children.map(inline))
        // A link that says more than its file's name keeps its words, with the chip after them.
        if (isFileLabel(plain(node.children), file)) return fileChip(file)
        return el("span", [...node.children.map(inline), text(" "), fileChip(file)])
      }
      if (maskedLink(node.href, plain(node.children))) return { kind: "masked", href: node.href, children: node.children.map(inline) }
      return el("a", node.children.map(inline), {
        href: node.href,
        target: "_blank",
        rel: "noopener noreferrer",
        class: "rich-link",
      })
    }
  }
}

const alignAttrs = (align: ColumnAlign | undefined): Record<string, string> =>
  align ? { style: `text-align:${align}` } : {}

export function block(node: Block): RichNode {
  switch (node.t) {
    case "paragraph":
      return el("p", node.children.map(inline))
    case "heading":
      return el(`h${node.level}`, node.children.map(inline))
    case "list": {
      const items = node.items.map((item) => el("li", item.map(block)))
      return node.start === undefined
        ? el("ul", items)
        : el("ol", items, node.start === 1 ? {} : { start: String(node.start) })
    }
    case "quote":
      return el("blockquote", node.children.map(block))
    case "rule":
      return el("hr", [], { class: "rich-rule" })
    case "code_block":
      return { kind: "code", lang: node.lang, text: node.text }
    case "table": {
      const row = (cells: readonly (readonly Inline[])[], tag: "th" | "td") =>
        el("tr", cells.map((cell, i) => el(tag, cell.map(inline), alignAttrs(node.align[i]))))
      return el(
        "div",
        [el("table", [el("thead", [row(node.head, "th")]), el("tbody", node.rows.map((cells) => row(cells, "td")))])],
        { class: "rich-table-scroll" },
      )
    }
  }
}

function chips(nodes: readonly RichNode[], out: Extract<RichNode, { kind: "file" }>[] = []) {
  for (const node of nodes) {
    if (node.kind === "file") out.push(node)
    else if (node.kind === "el" || node.kind === "masked") chips(node.children, out)
  }
  return out
}

/** The message's tree. Two chips that share a file name show the parent folders that tell them apart. */
export function richNodes(tree: RichText): RichNode[] {
  const nodes = tree.map(block)
  const files = chips(nodes)
  const suffixes = parentSuffixes([...new Set(files.map((f) => f.file.path))])
  for (const chip of files) chip.label = chipLabel(chip.file, suffixes.get(chip.file.path))
  return nodes
}
