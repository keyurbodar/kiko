import { Link } from "@tanstack/solid-router"
import { RemixIcon, type Glyph } from "@kiko/ui/remix-icon"
import { For, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"

export type RowTone = "muted" | "danger" | "warning" | "accent"

export type RowAction = {
  label: string
  busy?: string | undefined
  chat?: string
  onClick?: () => void
  "data-action"?: string
}

const TONE: Record<RowTone, string> = {
  muted: "text-quaternary",
  danger: "text-danger",
  warning: "text-secondary",
  accent: "text-danger",
}

const RULE = "h-px bg-[var(--stroke-tertiary)]"
const STITCH =
  "h-[3px] bg-[radial-gradient(circle,var(--stroke-danger)_0_1px,transparent_1.3px)] bg-size-[6px_3px] mask-x-from-70% mask-x-to-100%"

const PILL =
  "inline-flex h-control-sm shrink-0 cursor-pointer items-center rounded-base bg-tertiary px-1.5 type-sm text-primary transition-[background-color,transform] duration-(--duration-fast) hover:bg-secondary active:scale-(--press-scale)"

export function SystemRow(props: {
  label: string
  detail?: string | undefined
  title?: string | undefined
  icon?: Glyph | undefined
  tone?: RowTone | undefined
  actions?: readonly RowAction[] | undefined
  children?: JSX.Element
  class?: string
  stitch?: boolean
  "data-component"?: string
  "data-message-id"?: string
}): JSX.Element {
  const tone = () => props.tone ?? "muted"
  return (
    <div
      role={tone() === "danger" ? "alert" : "separator"}
      class={cn(
        "mx-auto flex w-full max-w-(--chat-content-max-width) items-center gap-3 px-4 py-3 type-sm",
        TONE[tone()],
        props.class,
      )}
      data-component={props["data-component"] ?? "system-row"}
      data-tone={tone()}
      data-message-id={props["data-message-id"]}
    >
      <span class={cn("min-w-3 flex-1", props.stitch ? STITCH : RULE)} aria-hidden="true" />
      <span
        class={cn(
          "flex min-h-control-sm min-w-0 max-w-full items-center justify-center gap-x-1.5 gap-y-1",
          props.actions?.length && "flex-wrap",
        )}
      >
        <Show when={props.icon}>{(icon) => <RemixIcon icon={icon()} size={12} class="shrink-0" />}</Show>
        <Show when={props.label}>
          <span class="shrink-0">{props.label}</span>
        </Show>
        <Show when={props.detail}>
          {(detail) => (
            <span
              class={cn("min-w-0 select-text", props.tone === "danger" ? "max-w-xl break-words" : "max-w-80 truncate")}
              title={props.title ?? detail()}
              data-part="detail"
            >
              {detail()}
            </span>
          )}
        </Show>
        {props.children}
        <For each={props.actions?.slice(0, 2)}>
          {(action) => (
            <Show when={!action.busy} fallback={<span class="shrink-0 text-quaternary">{action.busy}</span>}>
              <Show
                when={action.chat}
                fallback={
                  <button
                    type="button"
                    class={PILL}
                    data-action={action["data-action"]}
                    onClick={() => action.onClick?.()}
                  >
                    {action.label}
                  </button>
                }
              >
                {(roomId) => (
                  <Link class={PILL} to="/chat/$roomId" params={{ roomId: roomId() }}>
                    {action.label}
                  </Link>
                )}
              </Show>
            </Show>
          )}
        </For>
      </span>
      <span class={cn("min-w-3 flex-1", props.stitch ? STITCH : RULE)} aria-hidden="true" />
    </div>
  )
}
