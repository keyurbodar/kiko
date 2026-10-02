import type { Block, ColumnAlign, Inline, RichText } from "@kiko/protocol"

/* The rich text tree as plain element data. `RichText.tsx` renders this and
 * nothing else, so the table test covers the whole tree-to-DOM mapping. No node
 * carries markup: every string is text, and the renderer never sets innerHTML. */
export type RichNode =
  | { kind: "text"; text: string }
  | { kind: "code"; lang?: string; text: string }
  | { kind: "mention"; slug: string }
  | { kind: "el"; tag: string; attrs: Record<string, string>; children: RichNode[] }

const el = (tag: string, children: RichNode[], attrs: Record<string, string> = {}): RichNode => ({
  kind: "el",
  tag,
  attrs,
  children,
})

const text = (value: string): RichNode => ({ kind: "text", text: value })

/** The server parser only emits these. Anything else renders as plain text. */
export const safeHref = (href: string): boolean => /^(https?:|mailto:)/i.test(href)

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
    case "code":
      return el("code", [text(node.text)], { class: "rich-inline-code" })
    case "mention":
      return { kind: "mention", slug: node.slug }
    case "link":
      if (!safeHref(node.href)) return el("span", node.children.map(inline))
      return el("a", node.children.map(inline), {
        href: node.href,
        target: "_blank",
        rel: "noopener noreferrer",
        class: "rich-link",
      })
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

export const richNodes = (tree: RichText): RichNode[] => tree.map(block)
