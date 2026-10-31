import { Show, type JSX } from "solid-js"

export function Cursor(props: { label?: string | undefined; style?: JSX.CSSProperties }): JSX.Element {
  return (
    <div
      class="pointer-events-none absolute top-0 left-0 z-10 will-change-[left,top]"
      style={props.style}
      data-component="computer-cursor"
      data-tone="agent"
    >
      <svg
        class="size-5 -translate-x-[3px] -translate-y-[2px] text-[#f0b45a] drop-shadow-[0_1px_2px_rgb(0_0_0/0.5)]"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 3 20 11.2 12.4 13.2 9.6 21 4 3Z" />
      </svg>
      <Show when={props.label}>
        {(label) => (
          <span class="absolute top-4 left-4 rounded-full bg-[#f0b45a] px-2 py-0.5 text-base leading-none font-medium whitespace-nowrap text-black shadow-sm">
            {label()}
          </span>
        )}
      </Show>
    </div>
  )
}
