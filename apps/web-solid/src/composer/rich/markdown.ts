export type Json = {
  type: string
  attrs?: Record<string, unknown>
  content?: Json[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}

const MARKS = ["link", "bold", "italic", "strike", "code"] as const
const WRAP: Record<string, string> = { bold: "**", italic: "*", strike: "~~" }
const MENTION = /(^|[^\w@/.-])@([a-z0-9-]{1,32})(?![\w-])/g

export function docToMarkdown(doc: Json): string {
  return blocks(doc.content ?? [], "\n\n").trim()
}

function blocks(nodes: Json[], gap: string): string {
  const parts: string[] = []
  let previous: Json | undefined
  for (const node of nodes) {
    const text = block(node)
    if (text === "") continue
    if (previous) parts.push(previous.type.endsWith("List") && node.type.endsWith("List") ? "\n\n" : gap)
    parts.push(text)
    previous = node
  }
  return parts.join("")
}

function block(node: Json): string {
  const children = node.content ?? []
  switch (node.type) {
    case "paragraph":
      return inline(children).replace(/\n+$/, "")
    case "blockquote":
      return prefixLines(blocks(children, "\n\n"), "> ", "> ").replace(/^> $/gm, ">")
    case "bulletList":
      return children.map((item) => prefixLines(itemText(item), "- ", "  ")).join("\n")
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1
      return children
        .map((item, index) => {
          const marker = `${start + index}. `
          return prefixLines(itemText(item), marker, " ".repeat(marker.length))
        })
        .join("\n")
    }
    case "codeBlock": {
      const body = children.map((child) => child.text ?? "").join("")
      const longest = Math.max(2, ...(body.match(/`{3,}/g) ?? []).map((run) => run.length))
      const fence = "`".repeat(longest + 1)
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : ""
      return `${fence}${language}\n${body}\n${fence}`
    }
    default:
      return ""
  }
}

function itemText(item: Json): string {
  const children = item.content ?? []
  const lines: string[] = []
  children.forEach((child, index) => {
    const text = block(child)
    if (text === "" && index > 0) return
    if (index > 0) lines.push(child.type.endsWith("List") ? "\n" : "\n\n")
    lines.push(text)
  })
  return lines.join("")
}

function prefixLines(text: string, first: string, rest: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? first : rest) + line)
    .join("\n")
}

function inline(nodes: Json[]): string {
  let out = ""
  let at = 0
  while (at < nodes.length) {
    const head = nodes[at]!
    const mark = MARKS.find((name) => head.marks?.some((m) => m.type === name))
    if (!mark) {
      out += leaf(head)
      at++
      continue
    }
    const same = (node: Json) => sameMark(head, node, mark)
    let end = at
    while (end < nodes.length && same(nodes[end]!)) end++
    const run = nodes.slice(at, end).map((node) => ({ ...node, marks: node.marks?.filter((m) => m.type !== mark || !same(node)) }))
    out += wrap(mark, head, run)
    at = end
  }
  return out
}

function sameMark(head: Json, node: Json, mark: string): boolean {
  const a = head.marks?.find((m) => m.type === mark)
  const b = node.marks?.find((m) => m.type === mark)
  return !!b && JSON.stringify(a?.attrs ?? null) === JSON.stringify(b.attrs ?? null)
}

function leaf(node: Json): string {
  if (node.type === "hardBreak") return "\n"
  if (node.type === "mention") return `@${String(node.attrs?.slug ?? "")}`
  if (node.type === "text") return node.text ?? ""
  return ""
}

function wrap(mark: string, head: Json, run: Json[]): string {
  if (mark === "code") {
    const body = run.map(leaf).join("")
    if (!body.trim()) return body
    const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((ticks) => ticks.length))
    const fence = "`".repeat(longest + 1)
    const pad = body.startsWith("`") || body.endsWith("`") ? " " : ""
    return `${fence}${pad}${body}${pad}${fence}`
  }
  const inner = inline(run)
  const lead = /^\s*/.exec(inner)![0]
  const trail = /\s*$/.exec(inner.slice(lead.length))![0]
  const core = inner.slice(lead.length, inner.length - trail.length)
  if (!core) return inner
  if (mark === "link") {
    const href = String(head.marks?.find((m) => m.type === "link")?.attrs?.href ?? "")
    return `${lead}[${core}](${href.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})${trail}`
  }
  const marker = WRAP[mark]!
  return `${lead}${marker}${core}${marker}${trail}`
}

export type ParseOptions = { isMention?: (slug: string) => boolean }

export function markdownToDoc(markdown: string, options: ParseOptions = {}): Json {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const content = parseBlocks(lines, options)
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }
}

const BULLET = /^( {0,3})([-*+]) (.*)$/
const ORDERED = /^( {0,3})(\d{1,9})[.)] (.*)$/
const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/

function parseBlocks(lines: string[], options: ParseOptions): Json[] {
  const out: Json[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at]!
    if (line.trim() === "") {
      at++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[2]!
      const body: string[] = []
      at++
      while (at < lines.length && !closes(lines[at]!, marker)) body.push(lines[at++]!)
      at++
      out.push({
        type: "codeBlock",
        ...(fence[3] ? { attrs: { language: fence[3] } } : {}),
        ...(body.length ? { content: [{ type: "text", text: body.join("\n") }] } : {}),
      })
      continue
    }
    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = []
      while (at < lines.length && /^ {0,3}>/.test(lines[at]!)) quoted.push(lines[at++]!.replace(/^ {0,3}> ?/, ""))
      out.push({ type: "blockquote", content: parseBlocks(quoted, options) })
      continue
    }
    const marker = BULLET.exec(line) ?? ORDERED.exec(line)
    if (marker) {
      const ordered = ORDERED.test(line)
      const kind = ordered ? ORDERED : BULLET
      const items: Json[] = []
      let start = 1
      while (at < lines.length) {
        const head = kind.exec(lines[at]!)
        if (!head) break
        if (items.length === 0 && ordered) start = Number(head[2])
        const width = head[1]!.length + (ordered ? head[2]!.length + 2 : 2)
        const body = [head[3]!]
        at++
        while (at < lines.length) {
          const next = lines[at]!
          if (next.trim() === "") {
            const after = lines[at + 1]
            if (after !== undefined && new RegExp(`^ {${width}}\\S`).test(after)) {
              body.push("")
              at++
              continue
            }
            break
          }
          if (!new RegExp(`^ {${width}}`).test(next)) break
          body.push(next.slice(width))
          at++
        }
        items.push({ type: "listItem", content: itemBlocks(body, options) })
      }
      out.push(ordered ? { type: "orderedList", attrs: { start }, content: items } : { type: "bulletList", content: items })
      continue
    }
    const text: string[] = []
    while (at < lines.length && lines[at]!.trim() !== "" && !FENCE.test(lines[at]!) && !(text.length > 0 && /^ {0,3}>/.test(lines[at]!))) {
      if (text.length > 0 && (BULLET.test(lines[at]!) || ORDERED.test(lines[at]!))) break
      text.push(lines[at++]!)
    }
    out.push(paragraph(text, options))
  }
  return out
}

function itemBlocks(body: string[], options: ParseOptions): Json[] {
  const parsed = parseBlocks(body, options)
  return parsed.length ? parsed : [{ type: "paragraph" }]
}

function closes(line: string, marker: string): boolean {
  const trimmed = line.trim()
  return trimmed.length >= marker.length && trimmed === marker[0]!.repeat(trimmed.length)
}

function paragraph(lines: string[], options: ParseOptions): Json {
  const content: Json[] = []
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: "hardBreak" })
    content.push(...inlines(line.replace(/\s+$/, ""), options, []))
  })
  return content.length ? { type: "paragraph", content } : { type: "paragraph" }
}

type Mark = { type: string; attrs?: Record<string, unknown> }

function inlines(text: string, options: ParseOptions, marks: Mark[]): Json[] {
  const out: Json[] = []
  let plain = ""
  const flush = () => {
    if (plain) out.push(...textNodes(plain, options, marks))
    plain = ""
  }
  let at = 0
  while (at < text.length) {
    const rest = text.slice(at)
    const code = /^(`+)([^`][\s\S]*?[^`]|[^`])\1(?!`)/.exec(rest)
    if (code) {
      flush()
      const body = code[2]!.length > 2 && code[2]!.startsWith(" ") && code[2]!.endsWith(" ") ? code[2]!.slice(1, -1) : code[2]!
      out.push({ type: "text", text: body, marks: [...marks, { type: "code" }] })
      at += code[0].length
      continue
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)
    if (link) {
      flush()
      out.push(...inlines(link[1]!, options, [...marks, { type: "link", attrs: { href: link[2] } }]))
      at += link[0].length
      continue
    }
    const wrapped =
      emphasis(rest, "***", ["bold", "italic"], options, marks) ??
      emphasis(rest, "**", ["bold"], options, marks) ??
      emphasis(rest, "~~", ["strike"], options, marks) ??
      emphasis(rest, "*", ["italic"], options, marks)
    if (wrapped) {
      flush()
      out.push(...wrapped.nodes)
      at += wrapped.length
      continue
    }
    plain += text[at]
    at++
  }
  flush()
  return out
}

function emphasis(rest: string, marker: string, kinds: string[], options: ParseOptions, marks: Mark[]) {
  if (!rest.startsWith(marker)) return null
  const after = rest[marker.length]
  if (after === undefined || /\s/.test(after) || after === marker[0]) return null
  let close = marker.length
  for (;;) {
    close = rest.indexOf(marker, close + 1)
    if (close < 0) return null
    const before = rest[close - 1]!
    const next = rest[close + marker.length]
    if (/\s/.test(before) || next === marker[0]) continue
    if (rest.slice(marker.length, close).includes("`") && (rest.slice(marker.length, close).match(/`/g)?.length ?? 0) % 2 === 1) continue
    return {
      length: close + marker.length,
      nodes: inlines(rest.slice(marker.length, close), options, [...marks, ...kinds.map((type) => ({ type }))]),
    }
  }
}

function textNodes(text: string, options: ParseOptions, marks: Mark[]): Json[] {
  const withMarks = (node: Json): Json => (marks.length ? { ...node, marks: marks } : node)
  if (!options.isMention) return [withMarks({ type: "text", text })]
  const out: Json[] = []
  let last = 0
  for (const match of text.matchAll(MENTION)) {
    const lead = match[1]!
    const slug = match[2]!
    if (!options.isMention(slug)) continue
    const start = match.index + lead.length
    if (start > last) out.push(withMarks({ type: "text", text: text.slice(last, start) }))
    out.push({ type: "mention", attrs: { slug } })
    last = start + 1 + slug.length
  }
  if (last < text.length) out.push(withMarks({ type: "text", text: text.slice(last) }))
  return out
}
