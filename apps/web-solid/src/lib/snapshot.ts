/*
 * Instant startup, architecture 19.2 (DEVIATION: the paint before any script).
 *
 * The HTML shell cannot run the app in 10 ms, but it can show what the app showed last time. When
 * the page hides, this saves the rendered screen (the HTML of #root, the stylesheets it used, and
 * the scroll offsets) under `kiko:snap`. The inline script in index.html puts it back in a fixed
 * layer, #snap, on the first frame, before any module loads. Once the app has painted the same
 * screen from IndexedDB underneath, `dismissSnapshot` removes the layer, so the hand-over shows no
 * change. The snapshot is the user's own screen in their own browser, kept for the same path only.
 */

export const SNAP_KEY = "kiko:snap"
/** localStorage holds about 5 MB per origin. A screen bigger than this is not worth the write. */
const MAX_BYTES = 1_500_000

type Snap = {
  v: 1
  path: string
  html: string
  /** Stylesheet URLs, which the shell loads from the HTTP cache before showing the layer. */
  links: string[]
  /** Inline styles (the dev server injects CSS as `<style>`). */
  styles: string[]
  /** Scroll offsets of elements inside #root, by their child-index path. */
  scroll: [string, number][]
}

function pathOf(el: Element, root: Element): string {
  const parts: number[] = []
  let node: Element | null = el
  while (node && node !== root) {
    const parent: Element | null = node.parentElement
    if (!parent) break
    parts.unshift(Array.prototype.indexOf.call(parent.children, node))
    node = parent
  }
  return parts.join("/")
}

/**
 * The stylesheets in force. A linked sheet (every sheet of a production build) is kept as its URL,
 * which the shell loads from the HTTP cache, so a save never serializes the CSS. Only an inline
 * `<style>` (the dev server's) is kept as text.
 */
function sheets(): { links: string[]; styles: string[] } {
  const links: string[] = []
  const styles: string[] = []
  for (const sheet of document.styleSheets) {
    const owner = sheet.ownerNode as Element | null
    if (owner?.hasAttribute("data-snap")) continue
    if (sheet.href) {
      links.push(sheet.href)
      continue
    }
    try {
      styles.push(Array.from(sheet.cssRules, (r) => r.cssText).join("\n"))
    } catch {}
  }
  return { links, styles }
}

function capture(): Snap | null {
  const root = document.getElementById("root")
  if (!root || !root.firstElementChild || root.querySelector("#boot")) return null
  const scroll: [string, number][] = []
  for (const el of root.querySelectorAll<HTMLElement>("*")) if (el.scrollTop > 0) scroll.push([pathOf(el, root), el.scrollTop])
  return {
    v: 1,
    path: location.pathname,
    html: root.innerHTML,
    // Every rule in force, as text, so the shell paints with no request at all. A sheet whose rules
    // cannot be read (another origin) is kept as a link.
    ...sheets(),
    scroll,
  }
}

/** A 32-bit FNV-1a hash, so an unchanged screen is not written again. */
export function hashText(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}
let savedHash: number | undefined

/** Saves the current screen. Cheap enough for every hide; never throws. */
export function saveSnapshot(): void {
  try {
    const snap = capture()
    if (!snap) return
    const json = JSON.stringify(snap)
    const hash = hashText(json)
    if (hash === savedHash) return
    savedHash = hash
    if (json.length > MAX_BYTES) {
      localStorage.removeItem(SNAP_KEY)
      return
    }
    localStorage.setItem(SNAP_KEY, json)
  } catch {
    // A full or blocked storage only costs the instant paint.
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(SNAP_KEY)
  } catch {}
  dismissSnapshot()
}

/** Removes the layer the shell painted. Safe to call twice. */
export function dismissSnapshot(): void {
  document.getElementById("snap")?.remove()
  // The shell's linked stylesheets stay: the app's lazy chunks find them by URL and do not load them again.
  for (const s of document.querySelectorAll("style[data-snap]")) s.remove()
}

/** How long after a route change the screen is taken, so the new page has painted. */
const ROUTE_SAVE_MS = 1500
let routeTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Takes the screen once after a route change, so a tab killed without `pagehide` (a phone, a
 * crash) still opens on a recent screen. Changes in a row make one save.
 */
export function snapshotAfterRoute(): void {
  if (routeTimer !== undefined) clearTimeout(routeTimer)
  routeTimer = setTimeout(() => {
    routeTimer = undefined
    if (document.visibilityState === "visible") saveSnapshot()
  }, ROUTE_SAVE_MS)
}

/**
 * Saves on every hide (switching tabs, closing, reloading) and once after each route change, and
 * removes the shell's layer once `ready` says the app painted, or after `maxMs` either way. Nothing
 * runs while the page sits still: a save serializes the whole screen.
 */
export function startSnapshots(ready: () => boolean, maxMs = 1500): void {
  const t0 = performance.now()
  const tick = () => {
    if (ready() || performance.now() - t0 > maxMs) return dismissSnapshot()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  addEventListener("pagehide", saveSnapshot)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveSnapshot()
  })
}
