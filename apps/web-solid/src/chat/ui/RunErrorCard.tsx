import { AlertCircleIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { For, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { GROUP_GUTTER } from "./MessageRow"
import type { RowAction } from "./SystemRow"
import "./run-error.css"

export function RunErrorCard(props: {
  label: string
  reason?: string | undefined
  note?: string | undefined
  title?: string | undefined
  actions?: readonly RowAction[] | undefined
  group?: boolean | undefined
  latest?: boolean | undefined
  "data-message-id"?: string
}): JSX.Element {
  return (
    <div
      role="alert"
      class={cn(
        "mx-auto w-full max-w-(--chat-content-max-width) px-4 pt-(--run-gap) pb-(--row-gap)",
        props.group && GROUP_GUTTER,
      )}
      data-component="run-error"
      data-latest={props.latest ? "" : undefined}
      data-message-id={props["data-message-id"]}
    >
      <Show
        when={props.latest}
        fallback={
          <p class="run-error-line" title={props.title}>
            <RemixIcon icon={AlertCircleIcon} size={14} class="run-error-icon" />
            <span class="shrink-0 text-fg2">{props.label}</span>
            <Show when={props.reason}>
              <span class="min-w-0 truncate">{props.reason}</span>
            </Show>
          </p>
        }
      >
        <div class="run-error-card">
          <RemixIcon icon={AlertCircleIcon} size={16} class="run-error-icon" />
          <div class="min-w-0">
            <p class="type-ui font-medium text-fg">{props.label}</p>
            <Show when={props.reason}>
              <p class="type-label text-fg2">{props.reason}</p>
            </Show>
            <Show when={props.note}>
              <p class="run-error-note" title={props.title} data-part="detail">
                {props.note}
              </p>
            </Show>
            <Show when={props.actions?.length}>
              <div class="run-error-actions">
                <For each={props.actions?.slice(0, 2)}>
                  {(action, index) => (
                    <button
                      type="button"
                      class="run-error-action"
                      data-primary={index() === 0 ? "" : undefined}
                      data-action={action["data-action"]}
                      disabled={!!action.busy}
                      onClick={() => action.onClick?.()}
                    >
                      {action.busy ?? action.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
