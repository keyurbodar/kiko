import { createEffect, Show } from "solid-js"

export function Broken(props: { error: unknown; reset: () => void }) {
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
  const stack = () => {
    const raw = props.error instanceof Error ? (props.error.stack ?? "") : ""
    const frames = raw.split("\n").filter((line) => /https?:\/\/|\/assets\//.test(line))
    return frames.slice(0, 4).join("\n")
  }
  createEffect(() => {
    console.error("view crashed", props.error)
  })
  return (
    <div class="grid min-h-dvh place-items-center p-6" role="alert" data-component="crash">
      <div class="flex w-full max-w-2xl flex-col items-center gap-3 text-center">
        <h1 class="text-lg font-medium text-foreground">Something in this view broke</h1>
        <p class="text-sm text-muted-foreground break-words">{message()}</p>
        <Show when={stack()}>
          {(frames) => (
            <pre
              class="max-h-40 w-full overflow-auto rounded-md bg-code-background p-3 text-left text-[11px] leading-relaxed whitespace-pre-wrap text-code-foreground"
              data-component="crash-stack"
            >
              {frames()}
            </pre>
          )}
        </Show>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-md bg-accent px-3 py-1.5 text-sm text-foreground hover:bg-accent-strong"
            onClick={props.reset}
          >
            Try again
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            onClick={() => location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}
