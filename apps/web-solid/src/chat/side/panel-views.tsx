import { createSignal, Show } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, ExpandIcon, MenuIcon, MoreIcon, SearchIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { FileSurface, FilesTree } from "../../files/pane"
import type { FileTreeHandle } from "../../files/tree"
import { MemoryError, MemoryList, useMemoryStore } from "../info/memory/views"
import { RoutinesPage } from "../info/routines"
import { TasksView } from "../info/tasks"
import { HelperPeek } from "../helpers/HelperPeek"
import { AgentPage } from "./agent"

type ViewProps<F = object> = { chatId: string; surface: F; close: () => void; onExpand?: () => void }

const HEADER_BUTTON =
  "grid size-8 shrink-0 place-items-center rounded-control text-fg2 transition-colors duration-(--dur-hover) hover:bg-hover hover:text-fg aria-pressed:bg-active aria-pressed:text-fg"

function FilesHeader(props: {
  search: boolean
  tree: boolean
  onSearch: () => void
  onTree: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onToggleAll: () => void
  onExpand?: () => void
  onClose: () => void
}) {
  return (
    <header class="flex h-[52px] shrink-0 items-center gap-2 px-4" data-component="files-panel-header">
      <h2 class="min-w-0 flex-1 type-label font-medium text-fg">Files</h2>
      <div class="flex items-center gap-1">
        <TooltipV2 placement="bottom" openDelay={500} value="Filter files">
          <button
            type="button"
            class={HEADER_BUTTON}
            aria-label="Filter files"
            aria-pressed={props.search}
            data-action="filter-files"
            onClick={props.onSearch}
          >
            <RemixIcon icon={SearchIcon} size={18} />
          </button>
        </TooltipV2>
        <TooltipV2 placement="bottom" openDelay={500} value="Show file tree">
          <button
            type="button"
            class={HEADER_BUTTON}
            aria-label="Show file tree"
            aria-pressed={props.tree}
            data-action="toggle-file-tree"
            onClick={props.onTree}
          >
            <RemixIcon icon={MenuIcon} size={18} />
          </button>
        </TooltipV2>
        <MenuV2 gutter={4} placement="bottom-end">
          <MenuV2.Trigger class={HEADER_BUTTON} aria-label="File options" data-action="file-options">
            <RemixIcon icon={MoreIcon} size={18} />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content class="min-w-48">
              <MenuV2.CheckboxItem checked={props.tree} onChange={props.onTree} closeOnSelect={false}>
                Show file tree
              </MenuV2.CheckboxItem>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={props.onNewFile}>New file</MenuV2.Item>
              <MenuV2.Item onSelect={props.onNewFolder}>New folder</MenuV2.Item>
              <MenuV2.Item onSelect={props.onToggleAll}>Expand or collapse folders</MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
        <Show when={props.onExpand}>
          <TooltipV2 placement="bottom" openDelay={500} value="Expand files">
            <button
              type="button"
              class={HEADER_BUTTON}
              aria-label="Expand files"
              data-action="expand-files"
              onClick={props.onExpand}
            >
              <RemixIcon icon={ExpandIcon} size={18} />
            </button>
          </TooltipV2>
        </Show>
        <TooltipV2 placement="bottom" openDelay={500} value="Close files">
          <button
            type="button"
            class={HEADER_BUTTON}
            aria-label="Close chat details"
            data-action="close-desk"
            onClick={props.onClose}
          >
            <RemixIcon icon={CloseIcon} size={18} />
          </button>
        </TooltipV2>
      </div>
    </header>
  )
}

function FilesLayout(props: { chatId: string; path?: string; close: () => void; onExpand?: () => void }) {
  const [search, setSearch] = createSignal(true)
  const [tree, setTree] = createSignal(true)
  let handle: FileTreeHandle | undefined
  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-component="files-workspace">
      <FilesHeader
        search={search()}
        tree={tree()}
        onSearch={() => setSearch(!search())}
        onTree={() => setTree(!tree())}
        onNewFile={() => {
          setTree(true)
          handle?.newFile()
        }}
        onNewFolder={() => {
          setTree(true)
          handle?.newFolder()
        }}
        onToggleAll={() => handle?.toggleAll()}
        onExpand={props.onExpand}
        onClose={props.close}
      />
      <div class="flex min-h-0 flex-1" data-component="files-split">
        <FileSurface chatId={props.chatId} path={props.path} />
        <Show when={tree()}>
          <div class="files-tree-rail" data-component="files-tree-rail">
            <FilesTree ref={(value) => (handle = value)} chatId={props.chatId} searchOpen={search()} />
          </div>
        </Show>
      </div>
    </div>
  )
}

export function FilesView(props: ViewProps) {
  return <FilesLayout chatId={props.chatId} close={props.close} onExpand={props.onExpand} />
}

export function FileView(props: ViewProps<{ path: string }>) {
  return <FilesLayout chatId={props.chatId} path={props.surface.path} close={props.close} onExpand={props.onExpand} />
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
