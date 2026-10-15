import type { Task, TaskStatus } from "@kiko/protocol"
import { CheckIcon, CircleDotIcon, CircleIcon, CirclePauseIcon, CircleXIcon, EllipsisIcon, GitPullRequestIcon } from "lucide-solid"
import { Dynamic } from "solid-js/web"
import { For, Show, type Component } from "solid-js"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TASK_LABEL, TASK_ORDER, taskDependencies } from "./tasks-model"

const ICONS: Record<TaskStatus, Component<{ class?: string }>> = { doing: CircleDotIcon, done: CheckIcon, todo: CircleIcon, blocked: CirclePauseIcon, review: GitPullRequestIcon, cancelled: CircleXIcon }

export function TaskIcon(props: { status: TaskStatus }) {
  return <span class="task-step-icon" data-status={props.status}><Dynamic component={ICONS[props.status]} class="size-3" /></span>
}

export function TaskList(props: { tasks: readonly Task[]; allTasks?: readonly Task[]; portalMount?: HTMLElement; group?: boolean; onStatus?: (id: string, status: TaskStatus) => void }) {
  return <ul class="task-steps" aria-label="Tasks">
    <For each={props.tasks}>{(task) => <li class="task-step" data-component="task-step" data-id={task.id} data-status={task.status}>
      <TaskIcon status={task.status} />
      <span class="task-step-content">
        <span class="sr-only">{TASK_LABEL[task.status]}: </span>
        <span>{task.title}</span>
        <Show when={(props.group && task.owner) || taskDependencies(task, props.allTasks ?? props.tasks).length || task.note}>
          <span class="task-step-detail">
            <Show when={props.group && task.owner}><span>@{task.owner}<Show when={taskDependencies(task, props.allTasks ?? props.tasks).length || task.note}> · </Show></span></Show>
            {taskDependencies(task, props.allTasks ?? props.tasks).length ? `Waits on ${taskDependencies(task, props.allTasks ?? props.tasks).join(", ")}` : task.note}
          </span>
        </Show>
      </span>
      <span class="task-step-state">{task.status === "doing" ? "now" : TASK_LABEL[task.status]}</span>
      <Show when={props.onStatus}>
        <MenuV2 placement="bottom-end">
          <MenuV2.Trigger class="task-step-menu" aria-label={`Change status: ${task.title}`}><EllipsisIcon class="size-3.5" /></MenuV2.Trigger>
          <MenuV2.Portal mount={props.portalMount}><MenuV2.Content>
            <MenuV2.RadioGroup value={task.status} onChange={(status) => props.onStatus?.(task.id, status as TaskStatus)}>
              <For each={TASK_ORDER}>{(status) => <MenuV2.RadioItem value={status}><TaskIcon status={status} />{TASK_LABEL[status]}</MenuV2.RadioItem>}</For>
            </MenuV2.RadioGroup>
          </MenuV2.Content></MenuV2.Portal>
        </MenuV2>
      </Show>
    </li>}</For>
  </ul>
}
