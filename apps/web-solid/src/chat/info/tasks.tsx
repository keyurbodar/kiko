import type { AgentSlug, Task, TaskStatus } from "@kiko/protocol"
import { createMemo, For, Show } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { useApp } from "../../lib/store"
export { openTasks } from "./tasks-model"

const ORDER: readonly TaskStatus[] = ["doing", "blocked", "todo", "review", "done", "cancelled"]
const NEXT: Record<TaskStatus, TaskStatus> = { todo: "doing", doing: "done", blocked: "doing", review: "done", done: "todo", cancelled: "todo" }
const LABEL: Record<TaskStatus, string> = { doing: "Doing", blocked: "Blocked", todo: "To do", review: "Review", done: "Done", cancelled: "Cancelled" }
const HUE: Record<TaskStatus, number> = { doing: 45, blocked: 25, todo: 265, review: 210, done: 150, cancelled: 0 }

export function groupTasks(tasks: readonly Task[]): { status: TaskStatus; tasks: Task[] }[] {
  return ORDER.map((status) => ({ status, tasks: tasks.filter((t) => t.status === status) })).filter((g) => g.tasks.length)
}

function StatusChip(props: { task: Task }) {
  const set = () => useApp.room()?.task({ op: "update", id: props.task.id, status: NEXT[props.task.status] })
  return (
    <button
      type="button"
      class="shrink-0 rounded-full px-2.5 py-1 text-xs hover:brightness-125"
      style={{ background: `oklch(0.62 0.13 ${HUE[props.task.status]} / 0.18)`, color: `oklch(0.8 0.13 ${HUE[props.task.status]})` }}
      title={`Mark ${LABEL[NEXT[props.task.status]].toLowerCase()}`}
      data-action="task-status"
      onClick={set}
    >
      {LABEL[props.task.status]}
    </button>
  )
}

export function TasksView() {
  const tasks = () => useApp.room()?.tasks() ?? []
  const groups = createMemo(() => groupTasks(tasks()))
  const title = (id: string) => tasks().find((t) => t.id === id)?.title ?? id
  return (
    <div class="flex flex-col gap-4" data-component="info-tasks">
      <For each={groups()} fallback={
          <div class="flex flex-col items-center gap-3 px-2 py-6">
            <p class="text-center text-sm text-muted-foreground">No tasks yet. The lead puts work here when a job needs splitting up.</p>
          </div>
        }>
        {(g) => (
          <section class="flex flex-col gap-1" data-status={g.status}>
            <h3 class="flex items-baseline gap-1.5 px-2.5 text-xs font-medium text-muted-foreground">
              {LABEL[g.status]}
              <span class="text-secondary-label">{g.tasks.length}</span>
            </h3>
            <div class="flex flex-col rounded-2xl bg-muted-foreground p-1">
              <For each={g.tasks}>
                {(t) => (
                  <div class="flex items-center gap-3 rounded-xl px-2.5 py-2" data-component="info-task" data-id={t.id}>
                    <Show when={t.owner} fallback={<span class="size-7 shrink-0 rounded-full bg-control" aria-hidden="true" />}>
                      {(owner) => <IdentityAvatar seed={owner() as AgentSlug} size={28} />}
                    </Show>
                    <span class="min-w-0 flex-1">
                      <span class={`block truncate text-[15px] ${t.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}>{t.title}</span>
                      <span class="block truncate text-xs text-muted-foreground">
                        {t.owner ? `@${t.owner}` : "Unassigned"}
                        <Show when={t.dependsOn.length}> · waits on {t.dependsOn.map(title).join(", ")}</Show>
                      </span>
                    </span>
                    <StatusChip task={t} />
                  </div>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  )
}
