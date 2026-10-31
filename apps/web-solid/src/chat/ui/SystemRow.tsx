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
  muted: "text-tertiary",
  danger: "text-danger",
  warning: "text-secondary",
  accent: "text-danger",
}

const RULE_LEFT = "h-px bg-[linear-gradient(90deg,transparent,var(--stroke-secondary))]"
const RULE_RIGHT = "h-px bg-[linear-gradient(90deg,var(--stroke-secondary),transparent)]"
const STITCH =
  "h-[3px] bg-[radial-gradient(circle,var(--stroke-secondary)_0_1px,transparent_1.3px)] bg-size-[6px_3px] mask-x-from-70% mask-x-to-100%"

const PILL =
  "shrink-0 cursor-pointer rounded-full bg-tertiary px-2.5 py-0.5 text-primary transition-colors duration-[120ms] hover:bg-quaternary"

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
        "mx-auto flex w-full max-w-(--chat-content-max-width) items-center gap-3 px-4 py-3 text-xs",
        TONE[tone()],
        props.class,
      )}
      data-component={props["data-component"] ?? "system-row"}
      data-tone={tone()}
      data-message-id={props["data-message-id"]}
    >
      <span class={cn("min-w-3 flex-1", props.stitch ? STITCH : RULE_LEFT)} aria-hidden="true" />
      <span
        class={cn(
          "flex min-w-0 max-w-full items-center justify-center gap-x-1.5 gap-y-1",
          tone() === "accent" || props.stitch
            ? ""
            : "min-h-6 rounded-full bg-[var(--bg-quinary)] px-2.5 shadow-[inset_0_0_0_1px_var(--stroke-tertiary)]",
          props.actions?.length && "flex-wrap",
        )}
      >
        <Show when={props.icon}>{(icon) => <RemixIcon icon={icon()} size={12} class="shrink-0" />}</Show>
        <Show when={props.label}>
          <span class={cn("shrink-0", tone() === "accent" ? "font-medium text-danger" : "text-secondary")}>{props.label}</span>
        </Show>
        <Show when={props.detail}>
          {(detail) => (
            <span
              class={cn(
                "min-w-0 select-text",
                props.tone === "danger" ? "max-w-xl break-words" : "max-w-80 truncate font-medium text-primary",
              )}
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
            <Show when={!action.busy} fallback={<span class="shrink-0 text-tertiary">{action.busy}</span>}>
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
      <span class={cn("min-w-3 flex-1", props.stitch ? STITCH : RULE_RIGHT)} aria-hidden="true" />
    </div>
  )
}
