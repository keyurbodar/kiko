import { Show, splitProps, type JSX } from "solid-js"
import { cn } from "../lib/cn"

/**
 * The one component behind every centred, senderless line in the transcript.
 *
 * - `default` is a live inline event ("agent joined"): `role="status"`, so a
 *   screen reader announces it as it arrives.
 * - `divider` is structure, not news: `role="separator"`, named by `label`.
 *   The date divider and the unread divider are both this variant. Announcing
 *   every date divider in a long transcript would be noise, so neither is a
 *   status.
 * - `tone="accent"` is the unread divider: a hairline either side of the
 *   label, both the accent at 45%, and an accent label.
 */
export function SystemMessage(props: {
  variant?: "default" | "divider"
  tone?: "plain" | "accent"
  icon?: JSX.Element
  /** Accessible name for a divider, since its children may be two spans. */
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
        "chat-system-message flex items-baseline justify-center gap-1.5 text-center text-xs",
        divider() ? "px-4 pt-3.5 pb-2.5" : "px-4 py-1",
        accent()
          ? [
              "mx-auto w-full max-w-(--content-max-w) items-center gap-2.5 pt-3 pb-2 text-accent",
              "before:h-px before:grow before:bg-[color-mix(in_oklch,var(--accent)_45%,transparent)]",
              "after:h-px after:grow after:bg-[color-mix(in_oklch,var(--accent)_45%,transparent)]",
            ]
          : "text-weak",
        local.class,
      )}
      data-component={rest["data-component"] ?? "chat-system-message"}
      data-variant={local.variant ?? "default"}
      role={divider() ? "separator" : "status"}
      aria-label={divider() ? local.label : undefined}
    >
      <span class={cn("inline-flex items-baseline gap-1.5", accent() && "shrink-0 font-medium")}>
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
