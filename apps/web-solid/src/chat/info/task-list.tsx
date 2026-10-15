import type { Member, Task, TaskStatus } from "@kiko/protocol"
import { CheckIcon, CircleDotIcon, CircleIcon, CirclePauseIcon, CircleXIcon, GitPullRequestIcon } from "lucide-solid"
import { Dynamic } from "solid-js/web"
import { For, Show, type Component } from "solid-js"
import { CollapsibleV2 as Collapsible } from "@kiko/ui/v2/collapsible-v2"
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
    <For each={props.tasks}>{(task) => <li data-component="task-step" data-id={task.id} data-status={task.status}>
      <Collapsible class="task-step" data-status={task.status}>
        <TaskIcon status={task.status} />
        <Collapsible.Trigger class="task-step-content" aria-label={`Task details: ${display(task.title)}`} title={display(task.title)}><span class="sr-only">{TASK_LABEL[task.status]}: </span><span class="task-step-title">{display(task.title)}</span></Collapsible.Trigger>
        <Show when={props.members.length > 1 && member(task.owner)}>{(owner) => <span class="task-step-owner" title={owner().name}><IdentityAvatar seed={owner().slug} size={18} /><span>{owner().name}</span></span>}</Show>
        <span class="task-step-state">{task.status === "doing" ? "now" : task.status === "blocked" || task.status === "review" ? TASK_LABEL[task.status] : ""}</span>
        <Collapsible.Content class="task-step-detail"><p>{display(task.title)}</p><Show when={task.note}><p>{display(task.note!)}</p></Show><Show when={taskDependencies(task, props.allTasks ?? props.tasks).length}><p>Waits on {taskDependencies(task, props.allTasks ?? props.tasks).join(", ")}</p></Show></Collapsible.Content>
      </Collapsible>
    </li>}</For>
  </ul>
}
