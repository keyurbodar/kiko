import { AlertCircleIcon, InfoIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { HoverCardV2 } from "@kiko/ui/v2/hover-card-v2"
import { createSignal, For, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { GROUP_GUTTER } from "./MessageRow"
import type { RowAction } from "./SystemRow"
import "./run-error.css"

export function RunErrorCard(props: {
  label: string
  reason?: string | undefined
  note?: string | undefined
  actions?: readonly RowAction[] | undefined
  group?: boolean | undefined
  latest?: boolean | undefined
  "data-message-id"?: string
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
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
      <div class="run-error">
        <HoverCardV2
          open={open()}
          onOpenChange={setOpen}
          openDelay={250}
          closeDelay={120}
          placement="top-start"
          gutter={8}
        >
          <HoverCardV2.Trigger
            as="button"
            type="button"
            role="button"
            class="run-error-head"
            aria-expanded={props.note ? open() : undefined}
            disabled={!props.note}
            onClick={() => setOpen((now) => !now)}
          >
            <RemixIcon icon={AlertCircleIcon} size={16} class="run-error-icon" />
            <span class="run-error-label">{props.label}</span>
            <Show when={props.reason}>
              <span class="run-error-reason">{props.reason}</span>
            </Show>
            <Show when={props.note}>
              <RemixIcon icon={InfoIcon} size={12} class="run-error-more" />
            </Show>
          </HoverCardV2.Trigger>
          <Show when={props.note}>
            <HoverCardV2.Portal>
              <HoverCardV2.Content class="run-error-pop" data-component="run-error-detail">
                <span class="run-error-pop-title">{props.reason ?? props.label}</span>
                <p class="run-error-note" data-part="detail">
                  {props.note}
                </p>
              </HoverCardV2.Content>
            </HoverCardV2.Portal>
          </Show>
        </HoverCardV2>
        <Show when={props.latest && props.actions?.length}>
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
  )
}
