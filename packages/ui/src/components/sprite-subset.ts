const HOST_ID = "kiko-sprite-subset"
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function copySymbol(text: string, name: string, id: string): string | null {
  const open = new RegExp(`<symbol[^>]*\\sid="${escapeRe(name)}"`).exec(text)
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
    const e = escapeRe(x)
    out = out
      .replace(new RegExp(` id="${e}"`, "g"), ` id="${id}-${x}"`)
      .replace(new RegExp(`url\\(#${e}\\)`, "g"), `url(#${id}-${x})`)
      .replace(new RegExp(`href="#${e}"`, "g"), `href="#${id}-${x}"`)
  }
  return out
}

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
