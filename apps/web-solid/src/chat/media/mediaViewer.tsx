import { makeEventListener } from "@solid-primitives/event-listener"
import { Show, createSignal, lazy, type JSX } from "solid-js"
import type { MediaItem } from "../../lib/types"

/**
 * Owns the viewer's open state. The viewer itself is a tier 3 chunk: this file
 * is a few lines and `viewer.tsx` (the dialog, the gestures, the flight) loads
 * on first use. A pointer down on a thumbnail starts the download, so by the
 * time the click lands the chunk is usually already here.
 */

const THUMB = '[data-component="chat-media-cell"]'

const loadViewer = () => import("./viewer")
const Viewer = lazy(loadViewer)

/** Start loading the viewer chunk. Safe to call any number of times. */
export function preloadMediaViewer(): void {
  void loadViewer()
}

export interface MediaViewerController {
  /** Wire this to a thumbnail's `onClick`. */
  open(items: readonly MediaItem[], index: number, caption?: string): void
  /** Render this once, anywhere in the tree. */
  view: JSX.Element
}

/**
 * The opener is captured HERE, at open time, not read on close: closing focuses
 * whatever was focused when the viewer opened, and by then the click that
 * opened it has already moved focus. It is also the thumbnail the picture
 * flies from and back to. Safari does not focus a button on click, so the last
 * thumbnail a pointer went down on is the fallback to the active element.
 */
export function createMediaViewer(): MediaViewerController {
  const [items, setItems] = createSignal<readonly MediaItem[]>([])
  const [index, setIndex] = createSignal(0)
  const [caption, setCaption] = createSignal<string | undefined>()
  const [isOpen, setOpen] = createSignal(false)
  const [origin, setOrigin] = createSignal<HTMLElement | undefined>()
  let opener: HTMLElement | null = null
  let pressed: HTMLElement | null = null

  makeEventListener(
    document,
    "pointerdown",
    (event) => {
      const thumb = event.target instanceof Element ? event.target.closest<HTMLElement>(THUMB) : null
      if (!thumb) return
      pressed = thumb
      preloadMediaViewer()
    },
    { capture: true, passive: true },
  )

  const close = () => {
    setOpen(false)
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    opener = null
    setOrigin(undefined)
  }

  return {
    open: (next, at, label) => {
      const active = document.activeElement
      opener = active instanceof HTMLElement ? active : null
      const thumb = opener?.matches(THUMB) ? opener : pressed
      pressed = null
      setOrigin(thumb?.isConnected ? thumb : undefined)
      setItems(next)
      setIndex(at)
      setCaption(label)
      setOpen(true)
    },
    view: (
      <Show when={isOpen()}>
        <Viewer
          items={items()}
          index={index()}
          caption={caption()}
          origin={origin()}
          onIndex={setIndex}
          onClose={close}
        />
      </Show>
    ),
  }
}
