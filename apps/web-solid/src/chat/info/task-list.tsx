import type { Agent, Member, Task, TaskStatus } from "@kiko/protocol"
import { CheckIcon, CircleDotIcon, CircleIcon, CirclePauseIcon, CircleXIcon, GitPullRequestIcon, UsersIcon } from "lucide-solid"
import { Dynamic } from "solid-js/web"
import { For, Show, type Component } from "solid-js"
import { AgentChip } from "../ui/agent-chip"
import { TASK_LABEL, taskDependencies, taskText, taskOwner } from "./tasks-model"

const ICONS: Record<TaskStatus, Component<{ class?: string }>> = { doing: CircleDotIcon, done: CheckIcon, todo: CircleIcon, blocked: CirclePauseIcon, review: GitPullRequestIcon, cancelled: CircleXIcon }

function TaskIcon(props: { status: TaskStatus }) {
  return <span class="task-step-icon" data-status={props.status}><Dynamic component={ICONS[props.status]} class="size-3" /></span>
}

export function TaskList(props: { tasks: readonly Task[]; allTasks?: readonly Task[]; members: readonly Member[]; agents?: readonly Pick<Agent, "slug" | "name">[]; showDetails?: boolean }) {
  const display = (text: string) => taskText(text, props.members)
  return <ul class="task-steps" aria-label="Tasks">
    <For each={props.tasks}>{(task) => {
      const owner = () => taskOwner(task, props.members, props.agents)
      return <li class="task-step" data-component="task-step" data-id={task.id} data-status={task.status}>
        <TaskIcon status={task.status} />
        <div class="task-step-body">
          <span class="task-step-owner"><Show when={owner().slug} fallback={<span class="task-step-unassigned"><UsersIcon class="size-3" />Unassigned</span>}>{(slug) => <AgentChip slug={slug()} name={owner().name} wrap />}</Show></span>
          <div class="task-step-content">
            <span class="sr-only">{TASK_LABEL[task.status]}: </span><span class="task-step-title">{display(task.title)}</span>
            <Show when={props.showDetails}>
              <Show when={task.note}><p class="task-step-detail">{display(task.note!)}</p></Show>
              <Show when={taskDependencies(task, props.allTasks ?? props.tasks).length}><p class="task-step-detail">Waits on {taskDependencies(task, props.allTasks ?? props.tasks).join(", ")}</p></Show>
            </Show>
          </div>
        </div>
        <span class="task-step-state">{task.status === "doing" ? "now" : task.status === "blocked" || task.status === "review" ? TASK_LABEL[task.status] : ""}</span>
      </li>
    }}</For>
  </ul>
}
