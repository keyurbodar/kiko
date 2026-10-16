import { GlobeIcon } from "lucide-solid"
import { createSignal, Show, type JSX } from "solid-js"
import { fileUrl } from "../../lib/file-token"

/* t3code's MarkdownLinkFavicon. The icon comes from the backend's own route, so the reader's browser
 * never asks the linked site. The 14px box is always there, so an icon that loads, or fails and turns
 * into a globe, moves nothing. */
const failed = new Set<string>()

export function LinkIcon(props: { host: string }): JSX.Element {
  const [gone, setGone] = createSignal(failed.has(props.host))
  return (
    <span class="rich-link-icon" aria-hidden="true" data-component="chat-link-icon">
      <Show when={!gone()} fallback={<GlobeIcon class="rich-link-icon-glyph" />}>
        <img
          class="rich-link-icon-glyph"
          src={fileUrl(`/api/favicon/${props.host}`)}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => {
            failed.add(props.host)
            setGone(true)
          }}
        />
      </Show>
    </span>
  )
}
