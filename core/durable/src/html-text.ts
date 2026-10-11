const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

const BLOCK = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|nav|main|aside|blockquote|pre|hr|title|dd|dt)\b[^>]*>/gi

const WS = /\s/
const WORD = /\w/

// The lazy `[\s\S]*?` the script pass used rescanned to the end of the page from every stray opener, so
// a page of unclosed `<script>` tags was quadratic. The old `<[^>]*>` was too, on a page of bare `<`.
// Both are now single passes. `closeIndex` finds the first `</tag\s*>` the way the regex did.
function closeIndex(lower: string, tag: string, from: number): number {
  const needle = `</${tag}`
  let i = lower.indexOf(needle, from)
  while (i >= 0) {
    let j = i + needle.length
    while (j < lower.length && WS.test(lower[j]!)) j++
    if (lower[j] === ">") return j + 1
    i = lower.indexOf(needle, i + 1)
  }
  return -1
}

function titleOf(head: string): string {
  const lower = head.toLowerCase()
  let i = lower.indexOf("<title")
  while (i >= 0) {
    const at = i + 6
    const next = lower[at]
    if (next === undefined || !WORD.test(next)) {
      const open = lower.indexOf(">", at)
      const close = open < 0 ? -1 : lower.indexOf("</title>", open + 1)
      return close >= 0 ? head.slice(open + 1, close) : ""
    }
    i = lower.indexOf("<title", i + 1)
  }
  return ""
}

function stripElements(html: string): string {
  const lower = html.toLowerCase()
  const open = /<(script|style|noscript|template|svg|head)\b/gi
  const exhausted = new Set<string>()
  let out = ""
  let end = 0
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const tag = (m[1] ?? "").toLowerCase()
    if (exhausted.has(tag)) continue
    const close = closeIndex(lower, tag, m.index + m[0].length)
    if (close < 0) {
      exhausted.add(tag)
      continue
    }
    out += html.slice(end, m.index)
    out += tag === "head" ? `${titleOf(html.slice(m.index, close))}\n` : " "
    end = close
    open.lastIndex = close
  }
  return out + html.slice(end)
}

export function htmlToText(html: string): string {
  const body = stripElements(html.replace(/<!--[\s\S]*?-->/g, ""))
    .replace(BLOCK, "\n")
    .replace(/<[^<>]*>/g, "")
  return decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\r]+/g, " ").trim())
    .filter((line, i, lines) => line !== "" || (i > 0 && lines[i - 1] !== ""))
    .join("\n")
    .trim()
}
