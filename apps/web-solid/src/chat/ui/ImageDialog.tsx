import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "@kiko/ui/icons"
import { Show, createSignal } from "solid-js"
import { wrapIndex } from "../../lib/attachments"
import type { DialogImage } from "./image-dialog"

/*
 * A picture at full size over a dark backdrop, after t3code's ExpandedImageDialog: the picture
 * centred, a close button above its corner, arrows when there are more, and the name and count
 * under it. It opens and closes with no animation, as every kiko overlay does. Escape and a click
 * on the backdrop close it (Kobalte's dialog), and the arrow keys move.
 */

const NAV = "absolute top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-white/90 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"

export default function ImageDialog(props: { images: readonly DialogImage[]; index: number; onClose: () => void }) {
  const [offset, setOffset] = createSignal(0)
  const [failed, setFailed] = createSignal<string | null>(null)
  const count = () => props.images.length
  const index = () => wrapIndex(props.index + offset(), count())
  const item = () => props.images[index()]
  const step = (by: -1 | 1) => setOffset((n) => n + by)

  return (
    <ModalV2 open onOpenChange={(open: boolean) => !open && props.onClose()}>
      <ModalV2.Portal>
        <ModalV2.Overlay class="bg-black/75" />
        <ModalV2.Content
          class="h-[92vh] w-[92vw] items-center justify-center"
          onKeyDown={(event: KeyboardEvent) => {
            if (count() < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
            event.preventDefault()
            step(event.key === "ArrowLeft" ? -1 : 1)
          }}
          onClick={(event: MouseEvent) => {
            if (event.target === event.currentTarget) props.onClose()
          }}
        >
          <ModalV2.Title class="sr-only">Image preview</ModalV2.Title>
          <Show when={count() > 1}>
            <button type="button" class={`${NAV} left-0`} aria-label="Previous image" onClick={() => step(-1)}>
              <HugeIcon icon={ChevronLeftIcon} size={20} />
            </button>
          </Show>
          <Show when={item()}>
            {(image) => (
              <div class="relative z-10 flex max-w-[calc(92vw-96px)] flex-col items-center" data-component="image-dialog">
                <button
                  type="button"
                  class="absolute -top-10 right-0 grid size-6 place-items-center rounded-md bg-black/65 text-white shadow-sm ring-1 ring-white/20 hover:bg-black/80 focus-visible:ring-white"
                  aria-label="Close image preview"
                  onClick={() => props.onClose()}
                >
                  <HugeIcon icon={CloseIcon} size={14} />
                </button>
                <Show
                  when={failed() !== image().src}
                  fallback={
                    <div role="alert" class="flex h-48 w-[min(92vw,32rem)] items-center justify-center rounded-lg border border-white/15 bg-black p-6 text-center text-sm text-white">
                      Image unavailable. The file may have been moved or deleted.
                    </div>
                  }
                >
                  <img
                    src={image().src}
                    alt={image().name}
                    class="block max-h-[min(86vh,calc(100vh-160px))] max-w-full rounded-lg border border-white/15 object-contain shadow-2xl"
                    draggable={false}
                    onError={() => setFailed(image().src)}
                  />
                </Show>
                <p class="mt-2 max-w-full truncate text-xs text-white/80" aria-live="polite" data-component="image-dialog-caption">
                  {image().name}
                  {count() > 1 ? ` (${index() + 1}/${count()})` : ""}
                </p>
              </div>
            )}
          </Show>
          <Show when={count() > 1}>
            <button type="button" class={`${NAV} right-0`} aria-label="Next image" onClick={() => step(1)}>
              <HugeIcon icon={ChevronRightIcon} size={20} />
            </button>
          </Show>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
