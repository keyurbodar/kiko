import { Show, createSignal, lazy, type JSX } from "solid-js"

/**
 * Owns the viewer's open state. The viewer itself is a lazy chunk: this file is a few lines and
 * `viewer.tsx` (the dialog, the gestures, the flight) loads on first use. The files tab opens a
 * picture with it.
 */

const Viewer = lazy(() => import("./viewer"))

/** One picture or clip the viewer shows. */
export interface ViewerItem {
  kind: "photo" | "video"
  src: string
  /** Intrinsic size in pixels, for the flight. Zero when it is not known; the viewer measures. */
  width: number
  height: number
  /** Frame shown before a video plays. */
  poster?: string
  /** Names the item for assistive tech and the caption. */
  alt: string
}

export interface MediaViewerController {
  /** Wire this to a thumbnail's `onClick`. */
  open(items: readonly ViewerItem[], index: number, caption?: string): void
  /** Render this once, anywhere in the tree. */
  view: JSX.Element
}

/**
 * The opener is captured at open time, not read on close: closing focuses whatever was focused
 * when the viewer opened, and the picture flies from it and back.
 */
export function createMediaViewer(): MediaViewerController {
  const [items, setItems] = createSignal<readonly ViewerItem[]>([])
  const [index, setIndex] = createSignal(0)
  const [caption, setCaption] = createSignal<string | undefined>()
  const [isOpen, setOpen] = createSignal(false)
  const [origin, setOrigin] = createSignal<HTMLElement | undefined>()
  let opener: HTMLElement | null = null

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
      setOrigin(opener?.isConnected ? opener : undefined)
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
