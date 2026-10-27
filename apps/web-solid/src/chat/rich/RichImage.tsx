import { RemixIcon } from "@kiko/ui/remix-icon"
import { ImageIcon } from "@kiko/ui/icons"
import { createSignal, Show, type JSX } from "solid-js"
import { fileSrc, room } from "../../state/room"
import { openThreadImages } from "../ui/image-dialog"
import { PlainFallback } from "./plain-fallback"

function LoadedImage(props: { alt: string; url?: string; fileId?: string }): JSX.Element {
  const [loaded, setLoaded] = createSignal(false)
  const [broken, setBroken] = createSignal(false)
  const src = () => {
    const chat = room.activeId()
    return props.url ?? (props.fileId && chat ? fileSrc(chat, props.fileId) : null)
  }
  const name = () => props.alt.trim() || "image"
  return (
    <Show when={src()}>
      {(href) => (
        <Show
          when={!broken()}
          fallback={
            <span class="rich-image-broken" data-component="chat-image-broken">
              <RemixIcon icon={ImageIcon} class="size-4 shrink-0" />
              <span>Image could not load</span>
              <Show when={/^https?:/i.test(href())}>
                <a class="rich-link" href={href()} target="_blank" rel="noopener noreferrer">
                  {name()}
                </a>
              </Show>
            </span>
          }
        >
          <button
            type="button"
            class="rich-image"
            data-component="chat-image"
            data-state={loaded() ? "ready" : "loading"}
            aria-label={`View ${name()}`}
            onClick={() => openThreadImages([{ src: href(), name: name() }], 0)}
          >
            <img
              src={href()}
              alt={props.alt}
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
            />
          </button>
        </Show>
      )}
    </Show>
  )
}

export function RichImage(props: { alt: string; url?: string; fileId?: string }): JSX.Element {
  return (
    <PlainFallback text={props.alt}>
      <LoadedImage alt={props.alt} url={props.url} fileId={props.fileId} />
    </PlainFallback>
  )
}
