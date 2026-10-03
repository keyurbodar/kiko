// Reads the head of an HTML page with HTMLRewriter. Architecture section 18.2.

export interface ParsedPage {
  title?: string
  description?: string
  siteName?: string
  /** Absolute third-party image URL. It never reaches the client. */
  image?: string
  /** Absolute third-party icon URL. It never reaches the client. */
  favicon?: string
  /** `<meta name="theme-color">`, when it is a CSS colour the client can paint. */
  themeColor?: string
}

const MAX_TEXT = 300
const HEAD_END = /<\/head\s*>/i

function clean(value: string | null | undefined, max = MAX_TEXT): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim()
  return text ? text.slice(0, max) : undefined
}

function absolute(value: string | null | undefined, base: string): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value.trim(), base)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined
  } catch {
    return undefined
  }
}

function pick(meta: Map<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = meta.get(key)
    if (value) return value
  }
  return undefined
}

export async function parsePreview(html: string, pageUrl: string): Promise<ParsedPage> {
  // Stop at the end of the head. The body never reaches the parser.
  const end = HEAD_END.exec(html)
  const head = end ? html.slice(0, end.index) : html

  const meta = new Map<string, string>()
  let title = ""
  let favicon: string | undefined
  let touch: string | undefined

  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") ?? el.getAttribute("name"))?.toLowerCase()
        const content = el.getAttribute("content")
        // A theme-color for dark mode only says little about the brand. The first plain one wins.
        if (key === "theme-color" && el.getAttribute("media")?.includes("dark")) return
        if (key && content && !meta.has(key)) meta.set(key, content)
      },
    })
    .on("title", {
      text(chunk) {
        title += chunk.text
      },
    })
    .on("link", {
      element(el) {
        const rel = el.getAttribute("rel")?.toLowerCase().split(/\s+/) ?? []
        const href = el.getAttribute("href")
        if (!href) return
        if (rel.includes("apple-touch-icon")) touch ??= href
        else if (rel.includes("icon")) favicon ??= href
      },
    })

  await rewriter.transform(new Response(head, { headers: { "content-type": "text/html" } })).text()

  return {
    title: clean(pick(meta, ["og:title", "twitter:title"]) ?? title),
    description: clean(pick(meta, ["og:description", "twitter:description", "description"]), 500),
    siteName: clean(meta.get("og:site_name")),
    image: absolute(pick(meta, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]), pageUrl),
    favicon: absolute(favicon ?? touch, pageUrl),
    themeColor: color(meta.get("theme-color")),
  }
}

// A hex, rgb(), or hsl() colour. Anything else, such as a CSS variable, could carry text into a style.
const COLOR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\(\s*[\d.%,\s/+-]+\))$/i

function color(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text && text.length <= 40 && COLOR.test(text) ? text.toLowerCase() : undefined
}

/** A page with no title, description, or image has nothing to show. */
export function hasContent(page: ParsedPage): boolean {
  return Boolean(page.title || page.description || page.image)
}
