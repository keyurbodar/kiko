import type { Member, Task, TaskStatus } from "@kiko/protocol"
import { CheckIcon, CircleDotIcon, CircleIcon, CirclePauseIcon, CircleXIcon, GitPullRequestIcon } from "lucide-solid"
import { Dynamic } from "solid-js/web"
import { For, Show, type Component } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { TASK_LABEL, taskDependencies, taskText } from "./tasks-model"

const ICONS: Record<TaskStatus, Component<{ class?: string }>> = { doing: CircleDotIcon, done: CheckIcon, todo: CircleIcon, blocked: CirclePauseIcon, review: GitPullRequestIcon, cancelled: CircleXIcon }

function TaskIcon(props: { status: TaskStatus }) {
  return <span class="task-step-icon" data-status={props.status}><Dynamic component={ICONS[props.status]} class="size-3" /></span>
}

export function TaskList(props: { tasks: readonly Task[]; allTasks?: readonly Task[]; members: readonly Member[] }) {
  const member = (slug: string | undefined) => props.members.find((m) => m.slug === slug)
  const display = (text: string) => taskText(text, props.members)
  return <ul class="task-steps" aria-label="Tasks">
    <For each={props.tasks}>{(task) => <li class="task-step" data-component="task-step" data-id={task.id} data-status={task.status}>
      <TaskIcon status={task.status} />
      <span class="task-step-content">
        <span class="sr-only">{TASK_LABEL[task.status]}: </span>
        <Show when={member(task.owner)}>{(owner) => <><span class="task-step-owner"><IdentityAvatar seed={owner().slug} size={16} /><span>{owner().name}</span><span class="task-step-separator" aria-hidden="true">·</span></span>{" "}</>}</Show>
        <span class="task-step-title">{display(task.title)}</span>
      </span>
      <span class="task-step-state">{task.status === "doing" ? "now" : task.status === "blocked" || task.status === "review" ? TASK_LABEL[task.status] : ""}</span>
      <Show when={task.note}><span class="task-step-detail">{display(task.note!)}</span></Show>
      <Show when={taskDependencies(task, props.allTasks ?? props.tasks).length}><span class="task-step-detail">Waits on {taskDependencies(task, props.allTasks ?? props.tasks).join(", ")}</span></Show>
    </li>}</For>
  </ul>
}
