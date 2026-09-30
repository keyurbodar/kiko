import { Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { ChatMessage } from "../../lib/types"

/** kat's fallback when an image carries no usable intrinsic size. */
const DEFAULT_ASPECT = 1.5

/**
 * An image message: the picture, and the button that opens it full-screen.
 *
 * The box is kat's, taken from `.bubble-image-trigger` — `width:
 * min(300px, calc(420px * aspect))` with `aspect-ratio: aspect`, so a wide
 * picture gets up to 420px and a tall one is held to 300px, and the bubble
 * reserves the right box before the bytes arrive instead of reflowing the
 * transcript when they do. The radius is kat's 12px rather than the bubble's
 * own pill, because the picture is a rectangle sitting inside a rounded
 * surface and inheriting the pill would round it into an oval.
 *
 * It is a `<button>`, not a clickable `<img>`: the picture opens a dialog, so
 * it has to be reachable and fireable from the keyboard, and `aria-label`
 * carries the alt text that the `<img>`'s own `alt` cannot once the button is
 * the labelled thing.
 *
 * `width`/`height` are on the `<img>` as well as in the style, so the intrinsic
 * ratio is available to the browser before load and the alt text has a box to
 * occupy when the image never arrives.
 */
export function MessageImage(props: {
  image: ChatMessage["image"]
  onOpen: (image: { src: string; name: string }) => void
}): JSX.Element {
  return (
    <Show when={props.image}>
      {(image) => {
        const aspect = () => {
          const { width, height } = image()
          return width > 0 && height > 0 ? width / height : DEFAULT_ASPECT
        }

        return (
          <button
            type="button"
            class={cn(
              "relative block overflow-hidden p-0",
              "cursor-pointer border-none bg-[var(--input-bg)]",
              "mb-1 rounded-[12px] last:mb-0",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]",
            )}
            // The two data-derived values, not utilities: they are computed per
            // message and a Tailwind arbitrary value would have to be built by
            // string concatenation, which the scanner cannot see and would emit
            // as a class matching no rule.
            style={{
              width: `min(300px, calc(420px * ${aspect()}))`,
              "aspect-ratio": String(aspect()),
            }}
            data-component="chat-image-trigger"
            aria-label={`Open image: ${image().alt}`}
            onClick={() => props.onOpen({ src: image().src, name: image().alt })}
          >
            <img
              class="block size-full rounded-[inherit] object-cover"
              data-slot="chat-image"
              src={image().src}
              alt={image().alt}
              width={image().width}
              height={image().height}
              draggable={false}
            />
          </button>
        )
      }}
    </Show>
  )
}
