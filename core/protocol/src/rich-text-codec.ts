import * as Schema from "effect/Schema"
import { Count } from "./base"
import { AgentSlug } from "./brands"
import type * as Rich from "./rich-text"

export type Inline = Rich.Inline
export type Block = Rich.Block
export type RichText = Rich.RichText
export type HeadingLevel = Rich.HeadingLevel
export type ColumnAlign = Rich.ColumnAlign

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
  Schema.Struct({ t: Schema.Literal("heading"), level: Schema.Literals([1, 2, 3, 4, 5, 6]), children: inlines }),
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
    align: Schema.Array(Schema.NullOr(Schema.Literals(["left", "center", "right"]))),
    head: Schema.Array(inlines),
    rows: Schema.Array(Schema.Array(inlines)),
  }),
])

export const RichText: Schema.Codec<RichText, unknown> = Schema.Array(Block)
