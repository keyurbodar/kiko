import { Show, createSignal, lazy, type JSX } from "solid-js"
import { loadOverlaysV2 } from "@kiko/ui/v2/overlays"

/* The dialog body loads on first open, so the transcript and the composer pay only for this. */
const ImageDialog = lazy(() => import("./ImageDialog"))

/** One picture the dialog shows: where it loads from and the name under it. */
export type DialogImage = { src: string; name: string }

export interface ImageDialogController {
  /** Opens on `images[index]`. The arrows move through the rest. */
  open(images: readonly DialogImage[], index: number): void
  /** Render this once, anywhere in the tree. */
  view: JSX.Element
}

/** One dialog per surface: one for the whole transcript, and one for the composer's strip. */
export function createImageDialog(): ImageDialogController {
  const [shown, setShown] = createSignal<{ images: readonly DialogImage[]; index: number } | null>(null)
  return {
    open: (images, index) => {
      // The modal shell is in the deferred overlay chunk. A page that has not loaded it yet loads it now.
      void loadOverlaysV2()
      setShown({ images, index })
    },
    view: (
      <Show when={shown()}>
        {(s) => <ImageDialog images={s().images} index={s().index} onClose={() => setShown(null)} />}
      </Show>
    ),
  }
}
