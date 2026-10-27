import { Match, Switch } from "solid-js"
import type { TaskMark } from "./desk-model"

export function MarkView(props: { mark: TaskMark; size?: number }) {
  const size = () => props.size ?? 18
  return (
    <svg
      viewBox="0 0 18 18"
      width={size()}
      height={size()}
      class="desk-mark shrink-0"
      data-component="desk-mark"
      data-mark={props.mark}
      fill="none"
      aria-hidden="true"
    >
      <Switch>
        <Match when={props.mark === "todo"}>
          <circle cx="9" cy="9" r="7.25" stroke="var(--fg4)" stroke-width="1.5" />
        </Match>
        <Match when={props.mark === "doing"}>
          <circle cx="9" cy="9" r="7.25" stroke="var(--fg4)" stroke-width="1.5" />
          <circle
            class="desk-mark-arc"
            cx="9"
            cy="9"
            r="7.25"
            stroke="var(--fg)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-dasharray="11 45"
          />
        </Match>
        <Match when={props.mark === "partial"}>
          <circle cx="9" cy="9" r="7.25" stroke="var(--fg2)" stroke-width="1.5" />
          <path d="M9 4.5A4.5 4.5 0 0 1 9 13.5Z" fill="var(--fg2)" />
        </Match>
        <Match when={props.mark === "done"}>
          <circle cx="9" cy="9" r="8" fill="var(--fg3)" />
          <circle cx="9" cy="9" r="2.3" fill="var(--bg)" />
        </Match>
        <Match when={props.mark === "waiting"}>
          <circle
            cx="9"
            cy="9"
            r="7.25"
            stroke="var(--fg3)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-dasharray="1.6 3.1"
          />
        </Match>
      </Switch>
    </svg>
  )
}
