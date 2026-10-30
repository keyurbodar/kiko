import type { Agent, Member, Task, TaskStatus } from "@kiko/protocol"
import { For, Match, Show, Switch } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { TASK_LABEL, taskDependencies, taskText, taskOwner } from "./tasks-model"

const CLOSED = new Set<TaskStatus>(["done", "cancelled"])

function TaskGlyph(props: { task: Task }) {
  return (
    <span
      class="task-glyph"
      data-status={props.task.status}
      role="img"
      aria-label={`${TASK_LABEL[props.task.status]}: ${props.task.title}`}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="8" cy="8" r="6.25" class="task-glyph-ring" />
        <Switch>
          <Match when={props.task.status === "doing"}>
            <path d="M8 1.75A6.25 6.25 0 0 1 14.25 8" class="task-glyph-arc" />
          </Match>
          <Match when={props.task.status === "done"}>
            <path d="M5.2 8.2l2 2 3.6-4" stroke-linejoin="round" class="task-glyph-mark" />
          </Match>
          <Match when={props.task.status === "cancelled"}>
            <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" class="task-glyph-mark" />
          </Match>
          <Match when={props.task.status === "blocked"}>
            <path d="M5.5 8h5" class="task-glyph-mark" />
          </Match>
          <Match when={props.task.status === "review"}>
            <path d="M8 4.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" stroke="none" class="task-glyph-mark" />
          </Match>
        </Switch>
      </svg>
    </span>
  )
}

export function TaskList(props: {
  tasks: readonly Task[]
  allTasks?: readonly Task[]
  members: readonly Member[]
  agents?: readonly Pick<Agent, "slug" | "name">[]
  showDetails?: boolean
}) {
  const display = (text: string) => taskText(text, props.members)
  return (
    <ul class="task-steps" aria-label="Tasks" data-details={props.showDetails ? "" : undefined}>
      <For each={props.tasks}>
        {(task) => {
          const owner = () => taskOwner(task, props.members, props.agents)
          const closed = () => CLOSED.has(task.status)
          return (
            <li class="task-step" data-component="task-step" data-id={task.id} data-status={task.status}>
              <TaskGlyph task={task} />
              <div class="task-step-content">
                <span class="task-step-title" data-closed={closed() || undefined} title={display(task.title)}>
                  {display(task.title)}
                </span>
                <Show when={props.showDetails && !closed()}>
                  <Show when={task.note}>
                    <p class="task-step-detail">{display(task.note!)}</p>
                  </Show>
                  <Show when={taskDependencies(task, props.allTasks ?? props.tasks).length}>
                    <p class="task-step-detail">
                      Waits on {taskDependencies(task, props.allTasks ?? props.tasks).join(", ")}
                    </p>
                  </Show>
                </Show>
              </div>
              <span class="task-step-state">
                {task.status === "doing"
                  ? "now"
                  : task.status === "blocked" || task.status === "review"
                    ? TASK_LABEL[task.status]
                    : ""}
              </span>
              <span class="task-step-owner" title={owner().name}>
                <Show when={owner().slug}>{(slug) => <IdentityAvatar seed={slug()} size={20} />}</Show>
                <span class="sr-only">{owner().name}</span>
              </span>
            </li>
          )
        }}
      </For>
    </ul>
  )
}
