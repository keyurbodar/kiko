import { Show, createSignal, lazy, onCleanup, type JSX } from "solid-js"
import { loadOverlaysV2 } from "@kiko/ui/v2/overlays"

/* The dialog body loads on first open, so the transcript and the composer pay only for this. */
const ImageDialog = lazy(() => import("./ImageDialog"))

/** One picture the dialog shows: where it loads from and the name under it. */
export type DialogImage = { src: string; name: string }

export interface ImageDialogController {
  /** Opens on `images[index]`. The arrows move through the rest. `from` is the thumbnail the picture grows out of and shrinks back to. */
  open(images: readonly DialogImage[], index: number, from?: Element | null): void
  /** Render this once, anywhere in the tree. */
  view: JSX.Element
}

/** One dialog per surface: one for the whole transcript, and one for the composer's strip. */
export function createImageDialog(): ImageDialogController {
  const [shown, setShown] = createSignal<{ images: readonly DialogImage[]; index: number; from: Element | null } | null>(null)
  /** What had focus when the dialog opened, usually the picture clicked. Focus goes back to it on close. */
  let opener: HTMLElement | null = null
  const close = () => {
    setShown(null)
    const back = opener
    opener = null
    // After the dialog's own focus scope lets go.
    requestAnimationFrame(() => back?.isConnected && back.focus({ preventScroll: true }))
  }
  return {
    open: (images, index, from) => {
      // The modal shell is in the deferred overlay chunk. A page that has not loaded it yet loads it now.
      void loadOverlaysV2()
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setShown({ images, index, from: from ?? null })
    },
    view: (
      <Show when={shown()}>
        {(s) => <ImageDialog images={s().images} index={s().index} from={s().from} onClose={close} />}
      </Show>
    ),
  }
}

let threadOpen: ImageDialogController["open"] | null = null

/** Makes `open` the transcript's dialog, so a picture chip deep in a message opens it. */
export function provideThreadImages(open: ImageDialogController["open"]) {
  threadOpen = open
  onCleanup(() => {
    if (threadOpen === open) threadOpen = null
  })
}

export const openThreadImages: ImageDialogController["open"] = (images, index) => threadOpen?.(images, index)
