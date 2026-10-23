import type { AgentSlug } from "./brands"

export type Inline =
  | { readonly t: "text"; readonly text: string }
  | { readonly t: "bold"; readonly children: readonly Inline[] }
  | { readonly t: "italic"; readonly children: readonly Inline[] }
  | { readonly t: "strike"; readonly children: readonly Inline[] }
  | { readonly t: "code"; readonly text: string }
  | { readonly t: "link"; readonly href: string; readonly children: readonly Inline[] }
  | { readonly t: "mention"; readonly slug: AgentSlug }

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export type ColumnAlign = "left" | "center" | "right" | null

export type Block =
  | { readonly t: "paragraph"; readonly children: readonly Inline[] }
  | { readonly t: "heading"; readonly level: HeadingLevel; readonly children: readonly Inline[] }
  | {
      readonly t: "list"
      readonly start?: number
      readonly loose?: boolean
      readonly items: readonly (readonly Block[])[]
    }
  | { readonly t: "quote"; readonly children: readonly Block[] }
  | { readonly t: "rule" }
  | { readonly t: "code_block"; readonly lang?: string; readonly text: string }
  | { readonly t: "image"; readonly alt: string; readonly url?: string; readonly fileId?: string }
  | {
      readonly t: "table"
      readonly align: readonly ColumnAlign[]
      readonly head: readonly (readonly Inline[])[]
      readonly rows: readonly (readonly (readonly Inline[])[])[]
    }

export type RichText = readonly Block[]

const inlineText = (nodes: readonly Inline[], name: (slug: string) => string): string =>
  nodes
    .map((n) => {
      switch (n.t) {
        case "text":
        case "code":
          return n.text
        case "mention":
          return `@${name(n.slug)}`
        default:
          return inlineText(n.children, name)
      }
    })
    .join("")

const blockText = (block: Block, name: (slug: string) => string): string => {
  switch (block.t) {
    case "paragraph":
    case "heading":
      return inlineText(block.children, name)
    case "list":
      return block.items.map((item) => item.map((b) => blockText(b, name)).join("\n")).join("\n")
    case "quote":
      return block.children.map((b) => blockText(b, name)).join("\n")
    case "rule":
      return ""
    case "code_block":
      return block.text
    case "image":
      return block.alt
    case "table":
      return [block.head, ...block.rows].map((row) => row.map((cell) => inlineText(cell, name)).join(" ")).join("\n")
  }
}

export function plainText(rich: RichText, name: (slug: string) => string = (slug) => slug): string {
  return rich.map((b) => blockText(b, name)).join("\n")
}
