import { cn } from "../../lib/cn"

export function ScrollFades(props: { showTop: boolean; showBottom: boolean; class?: string }) {
  return (
    <div
      class={cn("chat-fades pointer-events-none absolute inset-0 z-[5]", props.class)}
      data-component="chat-fades"
      aria-hidden="true"
    >
      {props.showTop ? (
        <div
          class={cn(
            "chat-fades__top absolute inset-x-0 top-0 h-6",
            "bg-[linear-gradient(to_bottom,var(--bg-chrome),transparent)]",
          )}
          data-component="chat-fade-top"
        />
      ) : null}
      {props.showBottom ? (
        <div
          class={cn(
            "chat-fades__bottom absolute inset-x-0 bottom-0 h-6",
            "bg-[linear-gradient(to_top,var(--bg-chrome),transparent)]",
          )}
          data-component="chat-fade-bottom"
        />
      ) : null}
    </div>
  )
}
