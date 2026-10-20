import type { AgentSlug } from "./ids"

export type Inline =
	| { t: "text"; text: string }
	| { t: "bold"; children: readonly Inline[] }
	| { t: "italic"; children: readonly Inline[] }
	| { t: "strike"; children: readonly Inline[] }
	| { t: "code"; text: string }
	| { t: "link"; href: string; children: readonly Inline[] }
	| { t: "mention"; slug: AgentSlug }

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export type ColumnAlign = "left" | "center" | "right" | null

export type Block =
	| { t: "paragraph"; children: readonly Inline[] }
	| { t: "heading"; level: HeadingLevel; children: readonly Inline[] }
	| { t: "list"; start?: number; loose?: boolean; items: readonly (readonly Block[])[] }
	| { t: "quote"; children: readonly Block[] }
	| { t: "rule" }
	| { t: "code_block"; lang?: string; text: string }
	| { t: "image"; alt: string; url?: string; fileId?: string }
	| { t: "table"; align: readonly ColumnAlign[]; head: readonly (readonly Inline[])[]; rows: readonly (readonly (readonly Inline[])[])[] }

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
