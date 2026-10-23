import * as Schema from "effect/Schema"
import { Count } from "./base"
import { AgentSlug } from "./ids"

export type Inline =
  | { readonly t: "text"; readonly text: string }
  | { readonly t: "bold"; readonly children: readonly Inline[] }
  | { readonly t: "italic"; readonly children: readonly Inline[] }
  | { readonly t: "strike"; readonly children: readonly Inline[] }
  | { readonly t: "code"; readonly text: string }
  | { readonly t: "link"; readonly href: string; readonly children: readonly Inline[] }
  | { readonly t: "mention"; readonly slug: AgentSlug }

export const HeadingLevel = Schema.Literals([1, 2, 3, 4, 5, 6])
export type HeadingLevel = typeof HeadingLevel.Type

export const ColumnAlign = Schema.NullOr(Schema.Literals(["left", "center", "right"]))
export type ColumnAlign = typeof ColumnAlign.Type

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

const inlineChildren = Schema.Array(Schema.suspend((): Schema.Codec<Inline, unknown> => Inline))

export const Inline: Schema.Codec<Inline, unknown> = Schema.Union([
  Schema.Struct({ t: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ t: Schema.Literal("bold"), children: inlineChildren }),
  Schema.Struct({ t: Schema.Literal("italic"), children: inlineChildren }),
  Schema.Struct({ t: Schema.Literal("strike"), children: inlineChildren }),
  Schema.Struct({ t: Schema.Literal("code"), text: Schema.String }),
  Schema.Struct({ t: Schema.Literal("link"), href: Schema.String, children: inlineChildren }),
  Schema.Struct({ t: Schema.Literal("mention"), slug: AgentSlug }),
])

const inlines = Schema.Array(Inline)
const blocks = Schema.Array(Schema.suspend((): Schema.Codec<Block, unknown> => Block))

export const Block: Schema.Codec<Block, unknown> = Schema.Union([
  Schema.Struct({ t: Schema.Literal("paragraph"), children: inlines }),
  Schema.Struct({ t: Schema.Literal("heading"), level: HeadingLevel, children: inlines }),
  Schema.Struct({
    t: Schema.Literal("list"),
    start: Schema.optionalKey(Count),
    loose: Schema.optionalKey(Schema.Boolean),
    items: Schema.Array(blocks),
  }),
  Schema.Struct({ t: Schema.Literal("quote"), children: blocks }),
  Schema.Struct({ t: Schema.Literal("rule") }),
  Schema.Struct({ t: Schema.Literal("code_block"), lang: Schema.optionalKey(Schema.String), text: Schema.String }),
  Schema.Struct({
    t: Schema.Literal("image"),
    alt: Schema.String,
    url: Schema.optionalKey(Schema.String),
    fileId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    t: Schema.Literal("table"),
    align: Schema.Array(ColumnAlign),
    head: Schema.Array(inlines),
    rows: Schema.Array(Schema.Array(inlines)),
  }),
])

export const RichText = Schema.Array(Block)
export type RichText = typeof RichText.Type

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
