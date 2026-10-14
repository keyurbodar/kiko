import { Show, splitProps, type JSX } from "solid-js"
import { cn } from "../lib/cn"

export function SystemMessage(props: {
  variant?: "default" | "divider"
  tone?: "plain" | "accent"
  icon?: JSX.Element
  label?: string
  class?: string
  children: JSX.Element
  "data-component"?: string
}): JSX.Element {
  const [local, rest] = splitProps(props, [
    "variant",
    "tone",
    "icon",
    "label",
    "class",
    "children",
  ])
  const divider = () => local.variant === "divider"
  const accent = () => local.tone === "accent"
  return (
    <div
      class={cn(
        "chat-system-message flex items-baseline justify-center gap-1.5 px-4 py-3 text-center text-sm leading-4",
        accent()
          ? [
              "mx-auto w-full max-w-(--chat-content-max-width) items-center gap-2.5 text-ring",
              "before:h-px before:grow before:bg-[color-mix(in_oklch,var(--ring)_45%,transparent)]",
              "after:h-px after:grow after:bg-[color-mix(in_oklch,var(--ring)_45%,transparent)]",
            ]
          : "text-muted-foreground",
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
        class={cn("inline-flex items-baseline gap-1.5", accent() && "shrink-0 font-medium")}
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
