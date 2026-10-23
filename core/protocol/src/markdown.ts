import { isAgentSlug } from "./ids"
import type { Block, ColumnAlign, HeadingLevel, Inline, RichText } from "./rich-text"
import { Lexer, type Token, type Tokens } from "marked"

const SAFE_LINK = /^(https?|mailto|file):/i
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i
const MENTION = /(^|[^\w@/.-])@([a-z0-9-]{1,32})(?![\w-])/g
const TASK_MARKER = /^\[[ xX]\]\s*/

function parses(href: string): boolean {
  try {
    return new URL(href).href !== ""
  } catch {
    return false
  }
}

export type ImageFile = (path: string) => string | null

export function parseRichText(markdown: string, imageFile: ImageFile = () => null): RichText {
  return blocks(Lexer.lex(markdown, { gfm: true, breaks: true }), imageFile)
}

function blocks(tokens: readonly Token[], imageFile: ImageFile): Block[] {
  const out: Block[] = []
  for (const token of tokens) {
    const block = toBlock(token, imageFile)
    if (Array.isArray(block)) out.push(...block)
    else if (block) out.push(block)
  }
  return out
}

function withImages(t: Tokens.Paragraph | Tokens.Text, imageFile: ImageFile): Block[] {
  const tokens = t.tokens ?? []
  if (!tokens.some((each) => each.type === "image"))
    return [{ t: "paragraph", children: t.tokens ? inlines(t.tokens) : mentions(t.text) }]
  const lines: Token[][] = []
  let line: Token[] = []
  for (const each of tokens) {
    if (each.type === "br") {
      lines.push(line)
      line = []
    } else line.push(each)
  }
  lines.push(line)
  const out: Block[] = []
  let run: Token[][] = []
  const flush = () => {
    if (!run.length) return
    const children = run.flatMap((each, i) =>
      i ? [{ t: "text" as const, text: "\n" }, ...inlines(each)] : inlines(each),
    )
    out.push({ t: "paragraph", children })
    run = []
  }
  for (const each of lines) {
    const sole = each.length === 1 ? each[0] : undefined
    if (sole?.type === "image") {
      flush()
      out.push(imageBlock(sole as Tokens.Image, imageFile))
      continue
    }
    if (each.length) run.push(each)
  }
  flush()
  return out.length ? out : [{ t: "paragraph", children: inlines(tokens) }]
}

function toBlock(token: Token, imageFile: ImageFile): Block | Block[] | null {
  switch (token.type) {
    case "paragraph":
    case "text":
      return withImages(token as Tokens.Paragraph | Tokens.Text, imageFile)
    case "heading": {
      const t = token as Tokens.Heading
      return { t: "heading", level: Math.min(Math.max(t.depth, 1), 6) as HeadingLevel, children: inlines(t.tokens) }
    }
    case "list": {
      const t = token as Tokens.List
      const items = t.items.map((item) =>
        item.task ? ticked(blocks(item.tokens, imageFile), item.checked === true) : blocks(item.tokens, imageFile),
      )
      const loose = t.loose ? { loose: true as const } : {}
      return t.ordered
        ? { t: "list", start: t.start === "" ? 1 : t.start, ...loose, items }
        : { t: "list", ...loose, items }
    }
    case "blockquote":
      return { t: "quote", children: blocks((token as Tokens.Blockquote).tokens, imageFile) }
    case "hr":
      return { t: "rule" }
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
      return null
  }
}

function imageBlock(image: Tokens.Image, imageFile: ImageFile): Block {
  const alt = image.text
  const href = image.href.trim()
  if (/^https:/i.test(href))
    return parses(href) ? { t: "image", alt, url: href } : { t: "paragraph", children: [{ t: "text", text: alt }] }
  if (SCHEME.test(href)) return { t: "paragraph", children: [{ t: "text", text: alt }] }
  const fileId = imageFile(href.replace(/[?#].*$/, "").replace(/^(\.?\/)+/, ""))
  return fileId
    ? { t: "image", alt, fileId }
    : { t: "paragraph", children: [{ t: "link", href, children: [{ t: "text", text: alt }] }] }
}

function ticked(item: Block[], checked: boolean): Block[] {
  const box: Inline = { t: "text", text: checked ? "☑ " : "☐ " }
  const [first, ...rest] = item
  if (first?.t === "paragraph") {
    const [head, ...tail] = first.children
    const stripped = head?.t === "text" ? head.text.replace(TASK_MARKER, "") : null
    const children =
      stripped === null ? first.children : stripped === "" ? tail : [{ t: "text" as const, text: stripped }, ...tail]
    return [{ ...first, children: [box, ...children] }, ...rest]
  }
  return [{ t: "paragraph", children: [box] }, ...item]
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
      const web = !/^(https?):/i.test(href) || parses(href)
      if (web && (SAFE_LINK.test(href) || !SCHEME.test(href))) out.push({ t: "link", href, children })
      else out.push(...children)
      return
    }
    case "image":
      return void out.push({ t: "text", text: (token as Tokens.Image).text })
    default:
      return void out.push({ t: "text", text: (token as { raw: string }).raw })
  }
}

function mentions(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(MENTION)) {
    const lead = m[1]
    const slug = m[2]
    if (lead === undefined || slug === undefined || !isAgentSlug(slug)) continue
    const start = m.index + lead.length
    if (start > last) out.push({ t: "text", text: text.slice(last, start) })
    out.push({ t: "mention", slug })
    last = start + 1 + slug.length
  }
  if (last < text.length) out.push({ t: "text", text: text.slice(last) })
  return out
}
