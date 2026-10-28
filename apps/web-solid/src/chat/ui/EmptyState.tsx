import { Show } from "solid-js"
import { profile } from "../../app/hosted"
import { Mochi } from "./Mochi"
import "./empty-state.css"

const partOfDay = (hour: number): string => {
  if (hour < 5) return "Late night"
  if (hour < 12) return "Morning"
  if (hour < 17) return "Afternoon"
  return "Evening"
}

export function greeting(name: string | undefined, now: Date): string {
  const first = name?.trim().split(/\s+/)[0]
  return first ? `${partOfDay(now.getHours())}, ${first}` : "What's on your mind?"
}

export function EmptyState(props: { working?: boolean }) {
  return (
    <div class="chat-empty" data-component="chat-empty">
      <Show when={props.working}>
        <span class="chat-empty-mochi" data-component="chat-empty-working">
          <Mochi size={52} />
        </span>
      </Show>
      <h1 class="font-display text-[32px] leading-10 font-normal tracking-[-0.015em] text-[var(--text-000)] [font-variation-settings:var(--display-variation)] sm:text-[40px] sm:leading-[46px]">
        {greeting(profile()?.name, new Date())}
      </h1>
    </div>
  )
}
