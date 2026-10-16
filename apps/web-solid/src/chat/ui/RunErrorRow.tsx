import { ButtonV2 } from "@kiko/ui/v2/button-v2"
import type { RunErrorAction } from "@kiko/protocol"
import { CircleAlertIcon } from "lucide-solid"
import { createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { openSettings } from "../../lib/errors"
import { useApp } from "../../lib/store"
import { openModelPicker } from "../../settings/model-picker"
import type { ChatMessage } from "../../lib/types"

/** A click that the room never answered frees the button again, so one lost frame is not the end of Retry. */
const RETRY_WAIT_MS = 8_000

const LABELS: Record<RunErrorAction, string> = { retry: "Retry", change_model: "Change model", open_settings: "Open settings" }

/**
 * A failed run, in the transcript where the answer would have been: what went wrong in one plain
 * sentence, and what the human can do. The buttons are for the newest line of the chat only, since
 * an older failure has been answered by what came after it.
 */
export default function RunErrorRow(props: { message: ChatMessage; slug: string; actions: readonly RunErrorAction[]; detail?: string | undefined; latest: boolean }): JSX.Element {
  const [retrying, setRetrying] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const busy = () => retrying() || useApp.typingSlugs().includes(props.slug)
  const run = (action: RunErrorAction) => {
    if (action === "retry") {
      setRetrying(true)
      timer = setTimeout(() => setRetrying(false), RETRY_WAIT_MS)
      useApp.retryRun(props.message.id)
    } else if (action === "change_model") openModelPicker(props.slug)
    else openSettings()
  }
  return (
    <div role="alert" class="mx-auto flex w-full max-w-(--chat-content-max-width) justify-center px-4 py-2" data-component="run-error" data-message-id={props.message.id}>
      <div class="flex max-w-full flex-col items-start gap-2 rounded-xl bg-error-surface px-3 py-2 text-sm text-foreground">
        <div class="flex min-w-0 items-start gap-2">
          <CircleAlertIcon class="mt-0.5 size-4 shrink-0 text-error" aria-hidden="true" />
          <div class="flex min-w-0 flex-col gap-0.5">
            <span>{props.message.body}</span>
            <Show when={props.detail}>
              {(detail) => (
                <span class="break-words text-xs text-muted-foreground select-text" data-part="run-error-detail">
                  {detail()}
                </span>
              )}
            </Show>
          </div>
        </div>
        <Show when={props.latest && props.actions.length > 0}>
          <div class="flex flex-wrap gap-1.5 ps-6" data-component="run-error-actions">
            <Show when={busy() && props.actions.includes("retry")}>
              <span class="self-center text-xs text-muted-foreground">Retrying</span>
            </Show>
            <For each={props.actions.filter((action) => !(action === "retry" && busy()))}>
              {(action) => (
                <ButtonV2 variant="outline" size="small" icon={action === "retry" ? "outline-reset" : undefined} data-action={action} onClick={() => run(action)}>
                  {LABELS[action]}
                </ButtonV2>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
