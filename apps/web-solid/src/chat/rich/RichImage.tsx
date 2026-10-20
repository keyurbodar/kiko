import { RemixIcon } from "@kiko/ui/remix-icon"
import { ImageIcon } from "@kiko/ui/icons"
import { createSignal, Show, type JSX } from "solid-js"
import { urls, useApp } from "../../lib/store"
import { openThreadImages } from "../ui/image-dialog"

export function RichImage(props: { alt: string; url?: string; fileId?: string }): JSX.Element {
  const [loaded, setLoaded] = createSignal(false)
  const [broken, setBroken] = createSignal(false)
  const src = () => {
    const chat = useApp.activeThreadId()
    return props.url ?? (props.fileId && chat ? urls.file(chat, props.fileId) : null)
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
            onClick={(event) => openThreadImages([{ src: href(), name: name() }], 0, event.currentTarget.querySelector("img"))}
          >
            <img src={href()} alt={props.alt} decoding="async" draggable={false} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />
          </button>
        </Show>
      )}
    </Show>
  )
}
