import { createSignal } from "solid-js"

/*
 * Which run's panel is open, and the run trees it can hang from. Tier 2: the tree and the host
 * read this, and the panel itself is a lazy chunk. The panel never opens by itself; only a click on
 * a tree's row sets `openRun`.
 *
 * The open run lives here, not in a tree, because the tree that opened it can go away while the
 * reader reads: the typing row's tree is replaced by the bubble's when it lands. The panel follows
 * whichever tree of its run is on screen.
 */

const [openRun, setOpenRun] = createSignal<string | null>(null)
const [anchors, setAnchors] = createSignal<Readonly<Record<string, readonly HTMLElement[]>>>({})
let opener: HTMLElement | undefined

export { openRun }

/** Opens a run's panel, or closes it when it is open. `from` is the row clicked, which gets focus back on close. */
export const toggleRun = (windowKey: string, from?: HTMLElement) => {
  opener = from
  setOpenRun((open) => (open === windowKey ? null : windowKey))
}
export const closeRun = () => setOpenRun(null)

/** The row that opened the panel, while it is in the page: the typing row's tree goes when the bubble lands. */
export const runOpener = (): HTMLElement | undefined => (opener?.isConnected ? opener : undefined)

/** Registers a tree of a run. Returns the call that takes it back. */
export function registerRunAnchor(windowKey: string, element: HTMLElement): () => void {
  setAnchors((all) => ({ ...all, [windowKey]: [...(all[windowKey] ?? []), element] }))
  return () =>
    setAnchors((all) => {
      const left = (all[windowKey] ?? []).filter((e) => e !== element)
      const { [windowKey]: _, ...rest } = all
      return left.length ? { ...rest, [windowKey]: left } : rest
    })
}

/** The newest tree of a run that is in the page, or undefined. */
export const runAnchor = (windowKey: string): HTMLElement | undefined => anchors()[windowKey]?.findLast((e) => e.isConnected)

/** Loads the panel's chunk ahead of the click. */
export const preloadRunPanel = () => void import("./RunPanel")
