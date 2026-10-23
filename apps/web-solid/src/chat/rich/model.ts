import type { Block, Inline, RichText } from "@kiko/protocol"
import isSuspiciousUrl from "../lib/richtext/suspicious"
import {
  bareFileName,
  chipLabel,
  hrefFile,
  inlineCodeFile,
  isFileLabel,
  parentSuffixes,
  type FileTarget,
} from "./file-links"

export type RichNode =
  | { kind: "text"; text: string }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "mention"; slug: string }
  | { kind: "file"; file: FileTarget; label: string; bare?: true }
  | { kind: "masked"; href: string; children: RichNode[] }
  | { kind: "image"; alt: string; url?: string; fileId?: string }
  | { kind: "el"; tag: string; attrs: Record<string, string>; children: RichNode[]; copy?: TableCopy }

export type TableCopy = { markdown: string; csv: string }

const el = (tag: string, children: RichNode[], attrs: Record<string, string> = {}): RichNode => ({
  kind: "el",
  tag,
  attrs,
  children,
})

const text = (value: string): RichNode => ({ kind: "text", text: value })

export const safeHref = (href: string): boolean => /^(https?:|mailto:)/i.test(href) && URL.canParse(href)

export const linkHost = (href: string): string | null =>
  /^https?:/i.test(href) && URL.canParse(href) ? new URL(href).hostname : null

const fileChip = (file: FileTarget): RichNode => ({ kind: "file", file, label: chipLabel(file) })

const plain = (nodes: readonly Inline[]): string =>
  nodes
    .map((n) => (n.t === "text" || n.t === "code" ? n.text : n.t === "mention" ? `@${n.slug}` : plain(n.children)))
    .join("")

const SHOWN_HOST = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/?#]|$)/i
const EMBEDDED_HOST = /(?:https?:\/\/|\bwww\.)((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/?#\s,;:!?)]|$)/gi
const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, "")

const shownHosts = (label: string): string[] => {
  const whole = SHOWN_HOST.exec(label.trim())?.[1]
  return whole ? [whole] : Array.from(label.matchAll(EMBEDDED_HOST), (m) => m[1]!)
}

export function linkLead(text: string): [string, string] {
  const lead = /^https?:\/\//i.exec(text)?.[0] ?? Array.from(text)[0] ?? ""
  return [lead, text.slice(lead.length)]
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
        if (isFileLabel(plain(node.children), file)) return fileChip(file)
        return el("span", [...node.children.map(inline), text(" "), fileChip(file)])
      }
      if (maskedLink(node.href, plain(node.children)))
        return { kind: "masked", href: node.href, children: node.children.map(inline) }
      return el("a", node.children.map(inline), {
        href: node.href,
        target: "_blank",
        rel: "noopener noreferrer",
        class: "rich-link",
      })
    }
  }
}

const isTaskItem = (item: readonly Block[]): boolean => {
  const first = item[0]
  return first?.t === "paragraph" && first.children[0]?.t === "text" && /^[☐☑] /.test(first.children[0].text)
}

function codeSpan(code: string): string {
  const runs = code.match(/`+/g) ?? []
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0)
  const fence = "`".repeat(longest > 0 ? longest + 1 : 1)
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : ""
  return `${fence}${pad}${code}${pad}${fence}`
}

function inlineMarkdown(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.t) {
        case "text":
          return node.text
        case "code":
          return codeSpan(node.text)
        case "mention":
          return `@${node.slug}`
        case "bold":
          return `**${inlineMarkdown(node.children)}**`
        case "italic":
          return `*${inlineMarkdown(node.children)}*`
        case "strike":
          return `~~${inlineMarkdown(node.children)}~~`
        case "link":
          return `[${inlineMarkdown(node.children)}](${node.href})`
      }
    })
    .join("")
}

function inlinePlain(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.t) {
        case "text":
        case "code":
          return node.text
        case "mention":
          return `@${node.slug}`
        default:
          return inlinePlain(node.children)
      }
    })
    .join("")
}

const markdownCell = (cell: readonly Inline[]): string =>
  inlineMarkdown(cell).replace(/\n+/g, " ").trim().replaceAll("|", "\\|")

const csvCell = (cell: readonly Inline[]): string => {
  const value = inlinePlain(cell).replace(/\s+/g, " ").trim()
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function tableCopy(node: Extract<Block, { t: "table" }>): TableCopy {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`
  const separator = node.head.map((_, i) =>
    node.align[i] === "center" ? ":---:" : node.align[i] === "right" ? "---:" : "---",
  )
  const markdown = [
    line(node.head.map(markdownCell)),
    line(separator),
    ...node.rows.map((row) => line(row.map(markdownCell))),
  ]
  const csv = [node.head, ...node.rows].map((row) => row.map(csvCell).join(",")).join("\n")
  return { markdown: markdown.join("\n"), csv }
}

export function block(node: Block): RichNode {
  switch (node.t) {
    case "paragraph":
      return el("p", node.children.map(inline))
    case "heading":
      return el(`h${node.level}`, node.children.map(inline))
    case "list": {
      const items = node.items.map((item) =>
        el("li", item.map(block), isTaskItem(item) ? { class: "task-list-item" } : {}),
      )
      const loose: Record<string, string> = node.loose ? { class: "rich-loose" } : {}
      return node.start === undefined
        ? el("ul", items, loose)
        : el("ol", items, { ...loose, ...(node.start === 1 ? {} : { start: String(node.start) }) })
    }
    case "quote":
      return el("blockquote", node.children.map(block))
    case "rule":
      return el("hr", [], { class: "rich-rule" })
    case "code_block":
      return { kind: "code", lang: node.lang, text: node.text }
    case "image":
      return {
        kind: "image",
        alt: node.alt,
        ...(node.url ? { url: node.url } : {}),
        ...(node.fileId ? { fileId: node.fileId } : {}),
      }
    case "table": {
      const row = (cells: readonly (readonly Inline[])[], tag: "th" | "td") =>
        el(
          "tr",
          cells.map((cell, i) => el(tag, cell.map(inline))),
        )
      return {
        kind: "el",
        tag: "div",
        attrs: { class: "rich-table-scroll" },
        children: [
          el("table", [
            el("thead", [row(node.head, "th")]),
            el(
              "tbody",
              node.rows.map((cells) => row(cells, "td")),
            ),
          ]),
        ],
        copy: tableCopy(node),
      }
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

const PHOTO_CAPTION_CHARS = 120

export function isPhotoTree(tree: RichText): boolean {
  if (!tree.some((block) => block.t === "image")) return false
  let captions = 0
  for (const block of tree) {
    if (block.t === "image") continue
    if (block.t !== "paragraph") return false
    if (plain(block.children).trim().length > PHOTO_CAPTION_CHARS) return false
    captions += 1
  }
  return captions <= 1
}

export function richNodes(tree: RichText): RichNode[] {
  const nodes = tree.map(block)
  const files = chips(nodes)
  const suffixes = parentSuffixes([...new Set(files.map((f) => f.file.path))])
  for (const chip of files) chip.label = chipLabel(chip.file, suffixes.get(chip.file.path))
  return nodes
}
