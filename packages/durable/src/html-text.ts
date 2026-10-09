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

export function htmlToText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, (whole, tag: string) =>
      tag.toLowerCase() === "head" ? (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(whole)?.[1] ?? "") + "\n" : " ",
    )
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, "")
  return decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\r]+/g, " ").trim())
    .filter((line, i, lines) => line !== "" || (i > 0 && lines[i - 1] !== ""))
    .join("\n")
    .trim()
}
