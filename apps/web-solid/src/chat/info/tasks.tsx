import { For, Show } from "solid-js"
import { room } from "../../state/room"
import { user } from "../../state/user"
import { leadName, PanelEmpty } from "./empty"
import { TaskList } from "./task-list"
import { groupTasks, TASK_LABEL } from "./tasks-model"
import "../../composer/cards/cards.css"

export function TasksView() {
  const tasks = () => room.tasks()
  return (
    <div data-component="info-tasks" class="flex flex-col gap-3 p-2">
      <For
        each={groupTasks(tasks())}
        fallback={
          <PanelEmpty
            component="tasks-empty"
            art="tasks"
            title="No tasks yet"
            line={`${leadName()} adds a plan here when there is work to track.`}
          />
        }
      >
        {(group) => (
          <section>
            <h3 class="px-2 pb-1 type-sm text-tertiary">
              {TASK_LABEL[group.status]} <span class="text-quaternary">{group.tasks.length}</span>
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
