import { RemixIcon } from "@kiko/ui/remix-icon"
import { GlobeIcon } from "@kiko/ui/icons"
import { createSignal, Show, type JSX } from "solid-js"
import { fileUrl } from "../../lib/file-token"

const failed = new Set<string>()
const GITHUB = /(^|\.)github\.com$/
const MARK =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"

export function LinkIcon(props: { host: string }): JSX.Element {
  const [gone, setGone] = createSignal(failed.has(props.host))
  return (
    <span class="rich-link-icon" aria-hidden="true" data-component="chat-link-icon">
      <Show when={!GITHUB.test(props.host)} fallback={<svg class="rich-link-icon-glyph" viewBox="0 0 16 16" fill="currentColor"><path d={MARK} /></svg>}>
      <Show when={!gone()} fallback={<RemixIcon icon={GlobeIcon} class="rich-link-icon-glyph" />}>
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
      </Show>
    </span>
  )
}
