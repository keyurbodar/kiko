import { Show, createSignal, onCleanup, type JSX } from "solid-js"
import type { DialogImage } from "./chat-images"
import ImageDialog from "./ImageDialog"

export interface ImageDialogController {
  open(images: readonly DialogImage[], index: number): void
  view: JSX.Element
}

export function createImageDialog(): ImageDialogController {
  const [shown, setShown] = createSignal<{ images: readonly DialogImage[]; index: number } | null>(null)
  let opener: HTMLElement | null = null
  const close = () => {
    setShown(null)
    const back = opener
    opener = null
    requestAnimationFrame(() => back?.isConnected && back.focus({ preventScroll: true }))
  }
  return {
    open: (images, index) => {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setShown({ images, index })
    },
    view: <Show when={shown()}>{(s) => <ImageDialog images={s().images} index={s().index} onClose={close} />}</Show>,
  }
}

let threadOpen: ImageDialogController["open"] | null = null

export function provideThreadImages(open: ImageDialogController["open"]) {
  threadOpen = open
  onCleanup(() => {
    if (threadOpen === open) threadOpen = null
  })
}

export const openThreadImages: ImageDialogController["open"] = (images, index) => threadOpen?.(images, index)
