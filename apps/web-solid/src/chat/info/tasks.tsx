import { For, Show } from "solid-js"
import { room } from "../../state/room"
import { user } from "../../state/user"
import { TaskList } from "./task-list"
import { groupTasks, TASK_LABEL } from "./tasks-model"
import "../../composer/cards/cards.css"

export function TasksView() {
  const tasks = () => room.tasks()
  return (
    <div data-component="info-tasks" class="flex flex-col gap-3">
      <For
        each={groupTasks(tasks())}
        fallback={
          <p class="px-2 py-6 text-center text-sm text-muted-foreground">
            No tasks yet. Your agent adds a plan when there is work to track.
          </p>
        }
      >
        {(group) => (
          <section>
            <h3 class="px-2 pb-1 text-xs font-medium text-muted-foreground">
              {TASK_LABEL[group.status]} <span class="text-secondary-label">{group.tasks.length}</span>
            </h3>
            <TaskList
              tasks={group.tasks}
              allTasks={tasks()}
              members={room.roomMembers()}
              agents={user.agents()}
              showDetails
            />
            <Show when={group.status === "blocked"}>
              <span class="sr-only">Blocked tasks wait for their dependencies.</span>
            </Show>
          </section>
        )}
      </For>
    </div>
  )
}
