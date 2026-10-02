// Architecture section 6.4. One function turns agent markdown into the
// protocol tree. The `marked` lexer is confined to this file. Nothing here
// emits HTML: a raw HTML token becomes text, and only http, https, and mailto
// links survive.

import { isAgentSlug, type Block, type ColumnAlign, type HeadingLevel, type Inline, type RichText } from "@kiko/protocol"
import { Lexer, type Token, type Tokens } from "marked"

const SAFE_LINK = /^(https?|mailto):/i
const MENTION = /(^|[^\w@/.-])@([a-z0-9-]{1,32})(?![\w-])/g

export function parseRichText(markdown: string): RichText {
	return blocks(Lexer.lex(markdown, { gfm: true }))
}

function blocks(tokens: readonly Token[]): Block[] {
	const out: Block[] = []
	for (const token of tokens) {
		const block = toBlock(token)
		if (block) out.push(block)
	}
	return out
}

function toBlock(token: Token): Block | null {
	switch (token.type) {
		case "paragraph":
		case "text": {
			const t = token as Tokens.Paragraph | Tokens.Text
			return { t: "paragraph", children: t.tokens ? inlines(t.tokens) : mentions(t.text) }
		}
		case "heading": {
			const t = token as Tokens.Heading
			return { t: "heading", level: Math.min(Math.max(t.depth, 1), 6) as HeadingLevel, children: inlines(t.tokens) }
		}
		case "list": {
			const t = token as Tokens.List
			const items = t.items.map((item) => blocks(item.tokens))
			return t.ordered ? { t: "list", start: t.start === "" ? 1 : t.start, items } : { t: "list", items }
		}
		case "blockquote":
			return { t: "quote", children: blocks((token as Tokens.Blockquote).tokens) }
		case "code": {
			const t = token as Tokens.Code
			const lang = t.lang?.trim().split(/\s+/)[0]
			return lang ? { t: "code_block", lang, text: t.text } : { t: "code_block", text: t.text }
		}
		case "table": {
			const t = token as Tokens.Table
			return {
				t: "table",
				align: t.align.map((a): ColumnAlign => (a === "left" || a === "center" || a === "right" ? a : null)),
				head: t.header.map((cell) => inlines(cell.tokens)),
				rows: t.rows.map((row) => row.map((cell) => inlines(cell.tokens))),
			}
		}
		case "html": {
			const text = (token as Tokens.HTML).text.trim()
			return text ? { t: "paragraph", children: [{ t: "text", text }] } : null
		}
		default:
			return null // space, hr, def
	}
}

function inlines(tokens: readonly Token[]): Inline[] {
	const out: Inline[] = []
	for (const token of tokens) push(out, token)
	return out
}

function push(out: Inline[], token: Token): void {
	switch (token.type) {
		case "text": {
			const t = token as Tokens.Text
			if (t.tokens) out.push(...inlines(t.tokens))
			else out.push(...mentions(t.text))
			return
		}
		case "escape":
			return void out.push({ t: "text", text: (token as Tokens.Escape).text })
		case "strong":
			return void out.push({ t: "bold", children: inlines((token as Tokens.Strong).tokens) })
		case "em":
			return void out.push({ t: "italic", children: inlines((token as Tokens.Em).tokens) })
		case "del":
			return void out.push({ t: "strike", children: inlines((token as Tokens.Del).tokens) })
		case "codespan":
			return void out.push({ t: "code", text: (token as Tokens.Codespan).text })
		case "br":
			return void out.push({ t: "text", text: "\n" })
		case "link": {
			const t = token as Tokens.Link
			const children = inlines(t.tokens)
			const href = t.href.trim()
			if (SAFE_LINK.test(href)) out.push({ t: "link", href, children })
			else out.push(...children)
			return
		}
		case "image":
			return void out.push({ t: "text", text: (token as Tokens.Image).text })
		default:
			// raw inline html and anything unknown: the source as plain text
			return void out.push({ t: "text", text: (token as { raw: string }).raw })
	}
}

function mentions(text: string): Inline[] {
	const out: Inline[] = []
	let last = 0
	for (const m of text.matchAll(MENTION)) {
		const slug = m[2]!
		if (!isAgentSlug(slug)) continue
		const start = m.index + m[1]!.length
		if (start > last) out.push({ t: "text", text: text.slice(last, start) })
		out.push({ t: "mention", slug })
		last = start + 1 + slug.length
	}
	if (last < text.length) out.push({ t: "text", text: text.slice(last) })
	return out
}
