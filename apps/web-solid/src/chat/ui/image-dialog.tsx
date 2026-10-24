import { Show, createSignal, lazy, onCleanup, type JSX } from "solid-js"

const ImageDialog = lazy(() => import("./ImageDialog"))

export type DialogImage = { src: string; name: string }

export interface ImageDialogController {
  open(images: readonly DialogImage[], index: number, from?: Element | null): void
  view: JSX.Element
}

export function createImageDialog(): ImageDialogController {
  const [shown, setShown] = createSignal<{
    images: readonly DialogImage[]
    index: number
    from: Element | null
  } | null>(null)
  let opener: HTMLElement | null = null
  const close = () => {
    setShown(null)
    const back = opener
    opener = null
    requestAnimationFrame(() => back?.isConnected && back.focus({ preventScroll: true }))
  }
  return {
    open: (images, index, from) => {
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

export function provideThreadImages(open: ImageDialogController["open"]) {
  threadOpen = open
  onCleanup(() => {
    if (threadOpen === open) threadOpen = null
  })
}

export const openThreadImages: ImageDialogController["open"] = (images, index) => threadOpen?.(images, index)
