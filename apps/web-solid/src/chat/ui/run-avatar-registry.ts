export const RUN_AVATAR_PX = 28
const FAR = 100_000

export type AvatarShape = { above: number; below: number }

type Entry = {
  track: () => HTMLElement | undefined
  runKey: () => string
  isRunEnd: () => boolean
  apply: (shape: AvatarShape | null) => void
}

type ScrollerState = {
  entries: Set<Entry>
  frame: number
  listener: () => void
}

const scrollers = new Map<HTMLElement, ScrollerState>()

function measure(scroller: HTMLElement, state: ScrollerState): void {
  const byKey = new Map<string, HTMLElement[]>()
  for (const row of scroller.querySelectorAll<HTMLElement>("[data-run-key]")) {
    const key = row.getAttribute("data-run-key")
    if (key === null) continue
    const held = byKey.get(key)
    if (held) held.push(row)
    else byKey.set(key, [row])
  }
  const box = scroller.getBoundingClientRect()
  for (const entry of state.entries) {
    const row = entry.track()?.parentElement
    const rows = byKey.get(entry.runKey())
    if (!row || !rows || rows[rows.length - 1] !== row) {
      entry.apply(null)
      continue
    }
    const first = rows[0]!
    const rect = row.getBoundingClientRect()
    const above = first.hasAttribute("data-run-first") ? Math.max(0, rect.top - first.getBoundingClientRect().top) : FAR
    const below = entry.isRunEnd() ? 0 : Math.max(0, Math.ceil(box.bottom - rect.bottom)) + RUN_AVATAR_PX
    entry.apply({ above, below })
  }
}

function schedule(scroller: HTMLElement, state: ScrollerState): void {
  if (state.frame) return
  state.frame = requestAnimationFrame(() => {
    state.frame = 0
    measure(scroller, state)
  })
}

export function registerRunAvatar(track: HTMLElement, entry: Entry): () => void {
  const scroller = track.closest<HTMLElement>("[data-virtual-scroll]")
  if (!scroller) return () => {}
  let state = scrollers.get(scroller)
  if (!state) {
    const fresh: ScrollerState = { entries: new Set(), frame: 0, listener: () => {} }
    fresh.listener = () => schedule(scroller, fresh)
    scroller.addEventListener("scroll", fresh.listener, { passive: true })
    scrollers.set(scroller, fresh)
    state = fresh
  }
  const held = state
  held.entries.add(entry)
  schedule(scroller, held)
  return () => {
    held.entries.delete(entry)
    if (held.entries.size === 0) {
      cancelAnimationFrame(held.frame)
      scroller.removeEventListener("scroll", held.listener)
      scrollers.delete(scroller)
      return
    }
    schedule(scroller, held)
  }
}

export function runRowsChanged(runKey: string): void {
  for (const [scroller, state] of scrollers) {
    for (const entry of state.entries)
      if (entry.runKey() === runKey) {
        schedule(scroller, state)
        break
      }
  }
}
