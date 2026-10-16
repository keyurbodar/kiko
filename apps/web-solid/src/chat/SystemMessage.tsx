import { Show, splitProps, type JSX } from "solid-js"
import { cn } from "../lib/cn"

export function SystemMessage(props: {
  variant?: "default" | "divider"
  icon?: JSX.Element
  label?: string
  class?: string
  children: JSX.Element
  "data-component"?: string
}): JSX.Element {
  const [local, rest] = splitProps(props, [
    "variant",
    "icon",
    "label",
    "class",
    "children",
  ])
  const divider = () => local.variant === "divider"
  return (
    <div
      class={cn(
        "chat-system-message flex items-baseline justify-center gap-1.5 px-4 py-3 text-center text-sm leading-4",
        "text-muted-foreground",
        local.class,
      )}
      data-component={rest["data-component"] ?? "chat-system-message"}
      data-variant={local.variant ?? "default"}
      role={divider() ? "separator" : "status"}
    >
      <Show when={divider() && local.label}>
        <span class="sr-only">{local.label}</span>
      </Show>
      <span
        class={"inline-flex items-baseline gap-1.5"}
        aria-hidden={divider() && local.label ? "true" : undefined}
      >
        <Show when={local.icon}>
          <span class="inline-flex shrink-0 self-center" aria-hidden="true">
            {local.icon}
          </span>
        </Show>
        {local.children}
      </span>
    </div>
  )
}
