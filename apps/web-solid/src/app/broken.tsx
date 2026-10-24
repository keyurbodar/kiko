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
    <div class="grid min-h-dvh place-items-center bg-bg p-6" role="alert" data-component="crash">
      <div class="flex w-full max-w-xl flex-col items-center gap-4 rounded-3xl bg-raise p-10 text-center shadow-[0_30px_80px_rgb(0_0_0/0.25)]">
        <h1
          class="font-display text-[32px] leading-10 font-normal tracking-[-0.015em] text-fg"
          style={{ "font-variation-settings": "var(--display-variation)" }}
        >
          Something in this view broke.
        </h1>
        <p class="text-[15px] leading-6 break-words text-fg2">{message()}</p>
        <Show when={stack()}>
          {(frames) => (
            <pre
              class="max-h-40 w-full overflow-auto rounded-2xl bg-hover p-3 text-left font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg2"
              data-component="crash-stack"
            >
              {frames()}
            </pre>
          )}
        </Show>
        <div class="flex gap-2">
          <button
            type="button"
            class="h-11 cursor-pointer rounded-xl bg-fg px-5 text-sm font-semibold text-bg transition-transform duration-[var(--dur-hover)] active:scale-[0.98]"
            onClick={props.reset}
          >
            Try again
          </button>
          <button
            type="button"
            class="h-11 cursor-pointer rounded-xl px-5 text-sm font-medium text-fg2 transition-colors duration-[var(--dur-hover)] hover:bg-hover hover:text-fg"
            onClick={() => location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}
