import { createSignal } from "solid-js"

/*
 * Which run's panel is open, and the chevrons it can hang from. Tier 2: the chevron and the host
 * read this, and the panel itself is a lazy chunk. The panel never opens by itself; only a click on
 * a chevron sets `openRun`.
 *
 * The open run lives here, not in a chevron, because the chevron that opened it can go away while
 * the reader reads: the typing row's chevron is replaced by the first bubble's when it lands. The
 * panel follows whichever chevron of its run is on screen.
 */

const [openRun, setOpenRun] = createSignal<string | null>(null)
const [anchors, setAnchors] = createSignal<Readonly<Record<string, readonly HTMLElement[]>>>({})

export { openRun }

export const toggleRun = (windowKey: string) => setOpenRun((open) => (open === windowKey ? null : windowKey))
export const closeRun = () => setOpenRun(null)

/** Registers a chevron of a run. Returns the call that takes it back. */
export function registerRunAnchor(windowKey: string, element: HTMLElement): () => void {
  setAnchors((all) => ({ ...all, [windowKey]: [...(all[windowKey] ?? []), element] }))
  return () =>
    setAnchors((all) => {
      const left = (all[windowKey] ?? []).filter((e) => e !== element)
      const { [windowKey]: _, ...rest } = all
      return left.length ? { ...rest, [windowKey]: left } : rest
    })
}

/** The newest chevron of a run that is in the page, or undefined. */
export const runAnchor = (windowKey: string): HTMLElement | undefined => anchors()[windowKey]?.findLast((e) => e.isConnected)

/** Loads the panel's chunk ahead of the click. */
export const preloadRunPanel = () => void import("./RunPanel")
