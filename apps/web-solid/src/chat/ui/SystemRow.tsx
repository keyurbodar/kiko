import { A } from "@solidjs/router"
import { RemixIcon, type Glyph } from "@kiko/ui/remix-icon"
import { For, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"

export type RowTone = "muted" | "danger" | "warning" | "accent"

/** A pill at the end of a row. `href` opens a route, `onClick` runs a handler. `busy` swaps the pill for its progress word. */
export type RowAction = { label: string; busy?: string | undefined; href?: string; onClick?: () => void; "data-action"?: string }

const TONE: Record<RowTone, string> = {
  muted: "text-muted-foreground",
  danger: "text-error",
  warning: "text-warning",
  accent: "text-ring",
}

const RULE: Record<RowTone, string> = {
  muted: "bg-border/70",
  danger: "bg-error/35",
  warning: "bg-warning/40",
  accent: "bg-ring/45",
}

const PILL =
  "shrink-0 cursor-pointer rounded-md border border-border/70 bg-background px-2.5 py-1 text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"

/**
 * The one row between messages for everything that is not a message, after t3code's
 * `TimelineSystemDivider`: a label and a detail between two rules, and up to two pills.
 */
export function SystemRow(props: {
  label: string
  detail?: string | undefined
  /** The full text when `detail` is cut short. */
  title?: string | undefined
  icon?: Glyph | undefined
  tone?: RowTone | undefined
  actions?: readonly RowAction[] | undefined
  children?: JSX.Element
  class?: string
  "data-component"?: string
  "data-message-id"?: string
}): JSX.Element {
  const tone = () => props.tone ?? "muted"
  return (
    <div
      role={tone() === "danger" ? "alert" : "separator"}
      class={cn("mx-auto flex w-full max-w-(--chat-content-max-width) items-center gap-3 px-4 py-2 text-xs", TONE[tone()], props.class)}
      data-component={props["data-component"] ?? "system-row"}
      data-tone={tone()}
      data-message-id={props["data-message-id"]}
    >
      <span class={cn("h-px min-w-3 flex-1", RULE[tone()])} aria-hidden="true" />
      <span class={cn("flex min-w-0 max-w-full items-center justify-center gap-x-1.5 gap-y-1", props.actions?.length && "flex-wrap")}>
        <Show when={props.icon}>{(icon) => <RemixIcon icon={icon()} size={12} class="shrink-0" />}</Show>
        <Show when={props.label}>
          <span class="shrink-0 font-medium">{props.label}</span>
        </Show>
        <Show when={props.detail}>
          {(detail) => (
            <span class="max-w-80 min-w-0 truncate opacity-70 select-text" title={props.title ?? detail()} data-part="detail">
              {detail()}
            </span>
          )}
        </Show>
        {props.children}
        <For each={props.actions?.slice(0, 2)}>
          {(action) => (
            <Show when={!action.busy} fallback={<span class="shrink-0 text-muted-foreground">{action.busy}</span>}>
              <Show
                when={action.href}
                fallback={
                  <button type="button" class={PILL} data-action={action["data-action"]} onClick={() => action.onClick?.()}>
                    {action.label}
                  </button>
                }
              >
                {(href) => (
                  <A class={PILL} href={href()}>
                    {action.label}
                  </A>
                )}
              </Show>
            </Show>
          )}
        </For>
      </span>
      <span class={cn("h-px min-w-3 flex-1", RULE[tone()])} aria-hidden="true" />
    </div>
  )
}
