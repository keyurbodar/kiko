import type { Agent, Member, Task, TaskStatus } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, CloseIcon } from "@kiko/ui/icons"
import { For, Show } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { room } from "../../state/room"
import { TASK_LABEL, taskDependencies, taskText, taskOwner } from "./tasks-model"

const CLOSED: readonly TaskStatus[] = ["done", "cancelled"]

function TaskCheck(props: { task: Task }) {
  const done = () => props.task.status === "done"
  return (
    <button
      type="button"
      class="task-check"
      data-status={props.task.status}
      role="checkbox"
      aria-checked={done()}
      aria-label={`${TASK_LABEL[props.task.status]}: ${props.task.title}`}
      disabled={props.task.status === "cancelled"}
      onClick={() => room.task({ op: "update", id: props.task.id, status: done() ? "todo" : "done" })}
    >
      <Show when={done()}>
        <RemixIcon icon={CheckIcon} class="task-check-mark" />
      </Show>
      <Show when={props.task.status === "cancelled"}>
        <RemixIcon icon={CloseIcon} class="task-check-mark" />
      </Show>
    </button>
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
    <ul class="task-steps" aria-label="Tasks">
      <For each={props.tasks}>
        {(task) => {
          const owner = () => taskOwner(task, props.members, props.agents)
          return (
            <li class="task-step" data-component="task-step" data-id={task.id} data-status={task.status}>
              <TaskCheck task={task} />
              <div class="task-step-content">
                <span class="task-step-title" data-closed={CLOSED.includes(task.status) || undefined}>
                  {display(task.title)}
                </span>
                <Show when={props.showDetails}>
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
