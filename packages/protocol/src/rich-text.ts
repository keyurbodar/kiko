// Architecture section 6.4. The server parses agent markdown once into this
// tree and stores it with the message. The client renders it and ships no
// parser. There is no HTML node: raw HTML arrives as text.

import type { AgentSlug } from "./ids"

export type Inline =
	| { t: "text"; text: string }
	| { t: "bold"; children: readonly Inline[] }
	| { t: "italic"; children: readonly Inline[] }
	| { t: "strike"; children: readonly Inline[] }
	| { t: "code"; text: string }
	/** `href` is `http`, `https`, or `mailto`. The server parser enforces it. */
	| { t: "link"; href: string; children: readonly Inline[] }
	| { t: "mention"; slug: AgentSlug }

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export type ColumnAlign = "left" | "center" | "right" | null

export type Block =
	| { t: "paragraph"; children: readonly Inline[] }
	| { t: "heading"; level: HeadingLevel; children: readonly Inline[] }
	/** Each item is a list of blocks, so a list can nest. A list is ordered when `start` is set. */
	| { t: "list"; start?: number; items: readonly (readonly Block[])[] }
	| { t: "quote"; children: readonly Block[] }
	| { t: "code_block"; lang?: string; text: string }
	/** `align` has one entry per column. `head` and each row have one cell per column. */
	| { t: "table"; align: readonly ColumnAlign[]; head: readonly (readonly Inline[])[]; rows: readonly (readonly (readonly Inline[])[])[] }

export type RichText = readonly Block[]
