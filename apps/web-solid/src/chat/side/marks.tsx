import { Match, Switch } from "solid-js"
import type { TaskMark } from "./desk-model"

export function MarkView(props: { mark: TaskMark; size?: number }) {
  const size = () => props.size ?? 16
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
          <circle cx="9" cy="9" r="7.25" stroke="var(--text-400)" stroke-width="1.5" />
        </Match>
        <Match when={props.mark === "doing"}>
          <circle cx="9" cy="9" r="7.25" stroke="var(--border-300)" stroke-width="1.5" />
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
          <circle cx="9" cy="9" r="7.25" stroke="var(--text-300)" stroke-width="1.5" />
          <circle cx="9" cy="9" r="3.4" fill="var(--text-300)" />
        </Match>
        <Match when={props.mark === "done"}>
          <circle cx="9" cy="9" r="7.25" stroke="var(--border-300)" stroke-width="1.5" />
          <circle class="desk-mark-disc" cx="9" cy="9" r="3.6" fill="var(--fg)" />
        </Match>
        <Match when={props.mark === "waiting"}>
          <circle
            cx="9"
            cy="9"
            r="7.25"
            stroke="var(--warning)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-dasharray="1.6 3.1"
          />
        </Match>
      </Switch>
    </svg>
  )
}
