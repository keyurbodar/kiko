import { Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"

export function Cursor(props: {
  tone: "you" | "agent"
  label?: string | undefined
  ref?: (el: HTMLDivElement) => void
  style?: JSX.CSSProperties
  class?: string
}): JSX.Element {
  return (
    <div
      ref={props.ref}
      class={cn("pointer-events-none absolute top-0 left-0 z-10 will-change-[left,top]", props.class)}
      style={props.style}
      data-component="computer-cursor"
      data-tone={props.tone}
    >
      <svg
        class={cn(
          "size-5 -translate-x-[3px] -translate-y-[2px] drop-shadow-[0_1px_2px_rgb(0_0_0/0.5)]",
          props.tone === "you" ? "text-white" : "text-[#f0b45a]",
        )}
        viewBox="0 0 24 24"
        fill={props.tone === "you" ? "rgb(0 0 0 / 0.35)" : "currentColor"}
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 3 20 11.2 12.4 13.2 9.6 21 4 3Z" />
      </svg>
      <Show when={props.label}>
        {(label) => (
          <span
            class={cn(
              "absolute top-4 left-4 rounded-full px-2 py-0.5 text-caption leading-none font-medium whitespace-nowrap shadow-sm",
              props.tone === "you" ? "bg-black/70 text-white" : "bg-[#f0b45a] text-black",
            )}
          >
            {label()}
          </span>
        )}
      </Show>
    </div>
  )
}
