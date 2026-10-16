import { ImageIcon } from "lucide-solid"
import { createSignal, Show, type JSX } from "solid-js"
import { urls, useApp } from "../../lib/store"
import { openThreadImages } from "../ui/image-dialog"

/**
 * An image a message shows on its own, after t3code's ChatMarkdownImage. The box holds a slot
 * until the picture decodes, then takes the picture's own proportions, never above 30rem wide or
 * tall. A click opens the image dialog. A picture that fails to load says so in a small box.
 */
export function RichImage(props: { alt: string; url?: string; fileId?: string }): JSX.Element {
  const [size, setSize] = createSignal<{ w: number; h: number } | null>(null)
  const [broken, setBroken] = createSignal(false)
  const src = () => {
    const chat = useApp.activeThreadId()
    return props.url ?? (props.fileId && chat ? urls.file(chat, props.fileId) : null)
  }
  const name = () => props.alt.trim() || "image"
  return (
    <Show when={src()}>
      {(href) => (
        <button
          type="button"
          class="rich-image"
          data-component="chat-image"
          data-state={broken() ? "broken" : size() ? "ready" : "loading"}
          style={size() ? { "aspect-ratio": `${size()!.w} / ${size()!.h}`, "max-width": `${size()!.w}px` } : undefined}
          aria-label={`View ${name()}`}
          onClick={(event) => openThreadImages([{ src: href(), name: name() }], 0, event.currentTarget.querySelector("img"))}
        >
          <Show when={!broken()} fallback={<><ImageIcon class="size-4 shrink-0" aria-hidden="true" /><span class="truncate">{name()}</span></>}>
            <img
              src={href()}
              alt={props.alt}
              decoding="async"
              draggable={false}
              onLoad={(event) => setSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
              onError={() => setBroken(true)}
            />
          </Show>
        </button>
      )}
    </Show>
  )
}
