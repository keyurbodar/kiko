/*
 * Only the symbols in use, copied out of a large sprite.
 *
 * A `<use href="sprite.svg#name">` makes the browser parse the whole sprite into a document of
 * its own and keep it for the life of the page. The file-icon sprite holds 1,089 symbols, so one
 * file tree held about 11,000 SVG nodes for a dozen icons. Here the sprite's text is fetched once
 * (an immutable hashed asset, so the HTTP cache answers), each symbol a page asks for is copied
 * into one small inline sprite, and the text is dropped after a short wait.
 *
 * A symbol's inner ids (gradients, clip paths) are only unique inside the sprite, so each copy
 * gets them prefixed with its own name. A `<use>` that points at an id added later resolves when
 * it appears, so an icon simply shows once its symbol lands.
 */

const HOST_ID = "kiko-sprite-subset"
/** How long the sprite's text stays after the last copy, for icons asked for right after. */
const KEEP_TEXT_MS = 30_000

function host(): SVGSVGElement | null {
  if (typeof document === "undefined" || !document.body) return null
  const found = document.getElementById(HOST_ID)
  if (found) return found as unknown as SVGSVGElement
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.id = HOST_ID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  document.body.appendChild(svg)
  return svg
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * One symbol of `text` with its id set to `id` and every inner id prefixed with `id-`.
 * Null when the sprite has no such symbol. Exported for the tests.
 */
export function copySymbol(text: string, name: string, id: string): string | null {
  const open = new RegExp(`<symbol[^>]*\\sid="${escape(name)}"`).exec(text)
  if (!open) return null
  const start = open.index
  const end = text.indexOf("</symbol>", start)
  if (end === -1) return null
  const symbol = text.slice(start, end + "</symbol>".length)
  const own = ` id="${name}"`
  const inner = new Set<string>()
  for (const m of symbol.matchAll(/ id="([^"]+)"/g)) if (` id="${m[1]}"` !== own) inner.add(m[1]!)
  let out = symbol.replace(own, ` id="${id}"`)
  for (const x of inner) {
    const e = escape(x)
    out = out
      .replace(new RegExp(` id="${e}"`, "g"), ` id="${id}-${x}"`)
      .replace(new RegExp(`url\\(#${e}\\)`, "g"), `url(#${id}-${x})`)
      .replace(new RegExp(`href="#${e}"`, "g"), `href="#${id}-${x}"`)
  }
  return out
}

/**
 * A loader for one sprite. `ref(name)` returns the in-page href for a symbol and makes sure it
 * gets copied. `prefix` keeps two sprites' names apart.
 */
export function spriteSubset(url: string, prefix: string) {
  const copied = new Set<string>()
  const wanted = new Set<string>()
  let text: Promise<string> | null = null
  let drop: ReturnType<typeof setTimeout> | undefined
  let scheduled = false

  async function flush() {
    scheduled = false
    const names = [...wanted]
    wanted.clear()
    if (names.length === 0) return
    text ??= fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`sprite ${r.status}`))))
    let source: string
    try {
      source = await text
    } catch {
      text = null
      for (const n of names) copied.delete(n)
      return
    }
    const parts: string[] = []
    for (const n of names) {
      const symbol = copySymbol(source, n, prefix + n)
      if (symbol) parts.push(symbol)
    }
    host()?.insertAdjacentHTML("beforeend", parts.join(""))
    if (drop !== undefined) clearTimeout(drop)
    drop = setTimeout(() => {
      drop = undefined
      text = null
    }, KEEP_TEXT_MS)
  }

  return (name: string): string => {
    if (!copied.has(name) && typeof document !== "undefined") {
      copied.add(name)
      wanted.add(name)
      if (!scheduled) {
        scheduled = true
        queueMicrotask(() => void flush())
      }
    }
    return `#${prefix}${name}`
  }
}
