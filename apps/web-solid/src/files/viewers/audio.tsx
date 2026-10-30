import { createSignal, Show, type JSX } from "solid-js"
import { SurfaceFailure } from "../chrome"

export default function AudioViewer(props: { src: string; name: string }): JSX.Element {
  const [failed, setFailed] = createSignal(false)
  return (
    <Show
      when={!failed()}
      fallback={<SurfaceFailure message="Unable to load audio." onRetry={() => setFailed(false)} />}
    >
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6" data-component="file-audio">
        <span class="w-full max-w-xl truncate text-hint text-fg3">{props.name}</span>
        <audio
          src={props.src}
          controls
          preload="metadata"
          aria-label={props.name}
          class="w-full max-w-xl"
          onError={() => setFailed(true)}
        />
      </div>
    </Show>
  )
}
