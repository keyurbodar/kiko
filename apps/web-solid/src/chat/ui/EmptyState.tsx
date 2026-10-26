import { Show } from "solid-js"
import { Mochi } from "./Mochi"
import "./empty-state.css"

export function EmptyState(props: { working?: boolean }) {
  return (
    <div class="chat-empty" data-component="chat-empty">
      <Show when={props.working}>
        <span class="chat-empty-mochi" data-component="chat-empty-working">
          <Mochi size={52} />
        </span>
      </Show>
      <h1 class="font-display text-[32px] leading-10 font-normal text-fg [font-variation-settings:var(--display-variation)] sm:text-[40px] sm:leading-[44px]">
        What's on your mind?
      </h1>
    </div>
  )
}
