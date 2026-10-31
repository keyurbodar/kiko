import { cachedUri } from "@kiko/avatar/uri"
import { KIKO } from "@kiko/protocol"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { Button } from "../settings/kit"

const COPIED_MS = 1200

export function Broken(props: { error: unknown; reset: () => void }) {
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
  const stack = () => {
    const raw = props.error instanceof Error ? (props.error.stack ?? "") : ""
    const frames = raw.split("\n").filter((line) => /https?:\/\/|\/assets\//.test(line))
    return frames.slice(0, 4).join("\n")
  }
  const details = () => [message(), stack()].filter(Boolean).join("\n")
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = () => {
    void navigator.clipboard?.writeText(details()).then(() => {
      setCopied(true)
      clearTimeout(timer)
      timer = setTimeout(() => setCopied(false), COPIED_MS)
    })
  }
  createEffect(() => {
    console.error("view crashed", props.error)
  })
  return (
    <div class="grid min-h-dvh place-items-center bg-chrome p-6" role="alert" data-component="crash">
      <div class="flex w-full min-w-0 max-w-[28rem] flex-col items-center gap-4 rounded-xl bg-elevated px-6 pt-8 pb-6 text-center shadow-[0_0_0_1px_var(--stroke-secondary),var(--box-shadow-dialog)]">
        <img
          src={cachedUri(KIKO, { flavour: "fubuki", mood: "dizzy" })}
          alt=""
          width={40}
          height={40}
          draggable={false}
        />
        <div class="flex flex-col gap-1.5">
          <h1 class="type-2xl font-semibold text-primary">Something broke in this view</h1>
          <p class="type-base text-secondary">Your chats are safe. Try again, or reload Kiko.</p>
        </div>
        <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row-reverse sm:justify-center">
          <Button variant="primary" size="lg" data-action="crash-retry" onClick={props.reset}>
            Try again
          </Button>
          <Button variant="ghost" size="lg" data-action="crash-reload" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
        <details class="group w-full text-left" data-component="crash-details">
          <summary class="mx-auto flex w-fit cursor-pointer list-none items-center gap-1 rounded-base px-2 py-1 type-sm text-tertiary transition-colors duration-(--duration-fast) hover:text-primary [&::-webkit-details-marker]:hidden">
            <span class="group-open:hidden">Show details</span>
            <span class="hidden group-open:inline">Hide details</span>
          </summary>
          <div class="mt-2 flex flex-col gap-2">
            <pre
              class="max-h-48 overflow-auto rounded-lg bg-editor p-3 shadow-[inset_0_0_0_1px_var(--stroke-tertiary)] type-code text-xs leading-[18px] [overflow-wrap:anywhere] whitespace-pre-wrap text-secondary"
              data-component="crash-stack"
            >
              {details()}
            </pre>
            <Show when={navigator.clipboard}>
              <Button variant="secondary" class="self-end" data-action="copy-crash" onClick={copy}>
                {copied() ? "Copied" : "Copy details"}
              </Button>
            </Show>
          </div>
        </details>
      </div>
    </div>
  )
}
