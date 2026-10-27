import { Show } from "solid-js"
import { FileSurface, FilesTree } from "../../files/pane"
import { MemoryError, MemoryList, useMemoryStore } from "../info/memory/views"
import { RoutinesPage } from "../info/routines"
import { TasksView } from "../info/tasks"
import { HelperPeek } from "../helpers/HelperPeek"
import { AgentPage } from "./agent"

type ViewProps<F = object> = { chatId: string; surface: F; close: () => void }

export function FilesView(props: ViewProps) {
  return <FilesTree chatId={props.chatId} />
}

export function FileView(props: ViewProps<{ path: string }>) {
  return <FileSurface chatId={props.chatId} path={props.surface.path} />
}

export function MemoryView() {
  const store = useMemoryStore()
  return (
    <Show when={store()} keyed>
      {(s) => (
        <div class="flex min-h-0 flex-1 flex-col gap-2" data-component="info-memory">
          <MemoryError store={s} />
          <MemoryList store={s} />
        </div>
      )}
    </Show>
  )
}

export function RoutinesView(props: ViewProps) {
  return <RoutinesPage chatId={props.chatId} />
}

export function TasksPanelView() {
  return (
    <div class="px-2.5 pb-3">
      <TasksView />
    </div>
  )
}

export function AgentView(props: ViewProps<{ slug: string }>) {
  return <AgentPage slug={props.surface.slug} chatId={props.chatId} onRemoved={props.close} />
}

export function HelperView(props: ViewProps<{ helper: string; window: string }>) {
  return <HelperPeek helper={props.surface.helper} window={props.surface.window} chatId={props.chatId} />
}
