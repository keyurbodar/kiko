import { fileName, type FileRef, type RoomId } from "@kiko/protocol"
import { CollapseAllIcon, DownloadIcon, ExpandAllIcon, ResetIcon } from "@kiko/ui/icons"
import { Pictogram } from "@kiko/ui/pictogram"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { FileTree as Pierre, type FileTreeDropContext, type FileTreeRenameEvent } from "@pierre/trees"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { attachFileRefs } from "../composer/file-refs"
import { fileRefToken } from "../composer/rich/file-ref"
import { Dialog } from "../lib/dialog"
import { setFileDrag } from "../lib/file-drag"
import { Button } from "../settings/kit"
import { fileSrc } from "../state/room"
import { owner, registry } from "../state/runtime"
import { areAllDirectoriesExpanded, setAllDirectoriesExpanded } from "./explorer/expansion"
import {
  basename,
  createParent,
  dirname,
  HOME,
  inHome,
  join,
  loadExpanded,
  pathsUnder,
  ROOT,
  saveExpanded,
  where,
} from "./model"
import { PIERRE_ICONS } from "./pierre-icons"
import { PIERRE_TREE_UNSAFE_CSS } from "./pierre-theme"
import { syncTree } from "./tree-sync"
import "./tree.css"

export type FileTreeHandle = {
  newFile: () => void
  newFolder: () => void
  toggleAll: () => void
}

export type FileTreeProps = {
  ref?: (handle: FileTreeHandle) => void
  roomId: string
  files: readonly FileRef[]
  folders?: readonly string[]
  active?: string | null
  revealId?: number
  focusSearch?: boolean
  onOpen?: (path: string) => void
  onOpenInNewTab?: (path: string) => void
  onNewFile?: (path: string) => void
  onNewFolder?: (path: string) => void
  onRename?: (from: string, to: string, paths: string[]) => void
  onDelete?: (path: string, paths: string[]) => void
  onMove?: (from: string, to: string) => void
}

type MenuTarget = { kind: "directory" | "file"; path: string }

const TOOL =
  "grid size-6 shrink-0 place-items-center rounded-base icon-tertiary transition-colors duration-(--duration-fast) hover:bg-quaternary hover:icon-primary aria-pressed:icon-primary"

const asFolder = (path: string) => `${path.replace(/\/+$/, "")}/`
const plain = (path: string) => path.replace(/\/+$/, "")
const isFolderPath = (path: string) => path.endsWith("/")

const canReachComposer = () =>
  typeof document !== "undefined" && document.querySelector('[data-component="composer-dock"]') !== null

const isTyping = (event: Event) =>
  event.composedPath().some((node) => node instanceof HTMLElement && node.hasAttribute("data-item-rename-input"))

function itemPathOf(event: Event): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.hasAttribute("data-item-path")) return node.getAttribute("data-item-path")
  }
  return null
}

function storage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function FolderToggleIcon(props: { open: boolean }) {
  return (
    <span class="kt-morph" data-open={props.open ? "" : undefined} aria-hidden="true">
      <RemixIcon icon={ExpandAllIcon} size={14} class="kt-morph-rest" />
      <RemixIcon icon={CollapseAllIcon} size={14} class="kt-morph-open" />
    </span>
  )
}

export function FileTree(props: FileTreeProps): JSX.Element {
  let host!: HTMLDivElement
  let held = new Set<string>()
  let treeSelection: string | null = null
  let handledReveal: { path: string; id: number } | null = null
  let syncingSelection = false
  let dragging = false
  let savedExpanded = ""
  let wasExpanded = new Set<string>()
  let refreshStops: (() => void)[] = []
  const sizes = new Map(props.files.map((file) => [file.name.replace(/^\/+/, ""), file.size]))
  let seeded = props.files.length > 0
  const pending = new Map<string, "file" | "folder">()

  const [model, setModel] = createSignal<Pierre>()
  const [version, setVersion] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [fresh, setFresh] = createSignal<ReadonlyMap<string, number>>(new Map())
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = createSignal<string | null>(null)
  const [menuPath, setMenuPath] = createSignal<string | null>(null)
  const [allOpen, setAllOpen] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)

  const filePaths = createMemo(() => props.files.map((f) => f.name.replace(/^\/+/, "")))
  const fileByPath = createMemo(() => new Map(filePaths().map((path, index) => [path, props.files[index]!])))
  const folderPaths = createMemo(() => (props.folders ?? []).map((f) => plain(f.replace(/^\/+/, ""))).filter(Boolean))
  const folderSet = createMemo(() => {
    const out = new Set(folderPaths())
    for (const path of filePaths()) for (let dir = dirname(path); dir !== ROOT; dir = dirname(dir)) out.add(dir)
    return out
  })
  const directories = createMemo(() => [...folderSet()].map(asFolder))
  const wanted = createMemo(() => [...filePaths(), ...folderPaths().map(asFolder)])

  const noMatches = createMemo(() => {
    if (!query().trim()) return false
    version()
    return (model()?.getSearchMatchingPaths().length ?? 0) === 0
  })

  const allExpanded = () => {
    version()
    const tree = model()
    return !!tree && areAllDirectoriesExpanded(tree, directories())
  }

  const expandedNow = (tree: Pierre) => {
    const open = new Set<string>()
    for (const dir of folderSet()) {
      const item = tree.getItem(asFolder(dir))
      if (item?.isDirectory() && "isExpanded" in item && item.isExpanded()) open.add(dir)
    }
    return open
  }

  const watchExpansion = (tree: Pierre) => {
    const open = expandedNow(tree)
    if ([...wasExpanded].some((dir) => !open.has(dir) && folderSet().has(dir))) setAllOpen(false)
    wasExpanded = open
    const key = [...open].sort().join("\n")
    if (key === savedExpanded) return
    savedExpanded = key
    saveExpanded(props.roomId, storage(), [...open])
  }

  const markOpened = (path: string) => setOpened(new Set([...opened(), path]))

  const openPath = (path: string) => {
    if (isFolderPath(path)) return
    treeSelection = path
    markOpened(path)
    props.onOpen?.(path)
  }

  const openPathInTab = (path: string) => (props.onOpenInNewTab ?? props.onOpen)?.(plain(path))

  const select = (path: string, focus: boolean) => {
    const tree = model()
    if (!tree) return
    syncingSelection = true
    for (const selected of tree.getSelectedPaths()) tree.getItem(selected)?.deselect()
    for (let dir = dirname(plain(path)); dir !== ROOT; dir = dirname(dir)) {
      const item = tree.getItem(asFolder(dir))
      if (item?.isDirectory() && "expand" in item) item.expand()
    }
    const item = tree.getItem(path)
    item?.select()
    tree.scrollToPath(path, { focus, offset: "center" })
    queueMicrotask(() => (syncingSelection = false))
  }

  const copyPath = (path: string) => {
    void navigator.clipboard
      .writeText(plain(path))
      .then(() => showToastV2({ title: "Path copied", variant: "success" }))
      .catch(() => showToastV2({ title: "Could not copy the path", variant: "error" }))
  }

  const copyMention = (path: string) => {
    void navigator.clipboard
      .writeText(fileRefToken(plain(path), isFolderPath(path)))
      .then(() => showToastV2({ title: "Mention copied", description: plain(path), variant: "success" }))
      .catch(() => showToastV2({ title: "Could not copy the mention", variant: "error" }))
  }

  const addToChat = (path: string) => {
    if (!canReachComposer() || !attachFileRefs([plain(path)]))
      showToastV2({ title: "Unable to add to chat", variant: "error" })
  }

  const download = (path: string) => {
    const file = fileByPath().get(plain(path))
    if (!file) return
    const link = document.createElement("a")
    link.href = fileSrc(where(props.roomId, plain(path)).space, file.id)
    link.download = fileName(plain(path))
    link.click()
  }

  const freshName = (parent: string, kind: "file" | "folder") => {
    const taken = new Set(wanted().map(plain))
    for (let n = 1; ; n++) {
      const name =
        kind === "folder" ? (n === 1 ? "new folder" : `new folder ${n}`) : n === 1 ? "untitled" : `untitled ${n}`
      if (!taken.has(join(parent, name))) return name
    }
  }

  const parentForNew = () => {
    const tree = model()
    const at = tree?.getFocusedPath() ?? tree?.getSelectedPaths().at(-1)
    return at && tree?.getItem(at) ? createParent(at) : ROOT
  }

  const create = (id: string, to: string) => {
    pending.delete(id)
    if (isFolderPath(id)) props.onNewFolder?.(plain(to))
    else props.onNewFile?.(to)
  }

  const renameInput = () =>
    host.querySelector("file-tree-container")?.shadowRoot?.querySelector<HTMLInputElement>("[data-item-rename-input]")

  const focusRename = (frames = 6) => {
    const input = renameInput()
    if (input) {
      input.focus()
      input.select()
      return
    }
    if (frames > 0) requestAnimationFrame(() => focusRename(frames - 1))
  }

  const settlePending = () => {
    const tree = model()
    if (!tree) return
    for (const id of pending.keys()) {
      if (!tree.getItem(id)) pending.delete(id)
      else if (!renameInput()) create(id, id)
    }
  }

  const startNew = (kind: "file" | "folder", parent = parentForNew()) => {
    const tree = model()
    if (!tree) return
    const path = join(parent, freshName(parent, kind))
    const id = kind === "folder" ? asFolder(path) : path
    pending.set(id, kind)
    tree.add(id)
    if (tree.startRenaming(id, { removeIfCanceled: true })) requestAnimationFrame(() => focusRename())
  }

  const beginRename = (path: string) => {
    if (model()?.startRenaming(path)) requestAnimationFrame(() => focusRename())
  }

  const onRename = (event: FileTreeRenameEvent) => {
    const id = event.isFolder ? asFolder(event.sourcePath) : event.sourcePath
    const to = event.isFolder ? asFolder(event.destinationPath) : event.destinationPath
    if (pending.has(id)) return create(id, to)
    const from = plain(event.sourcePath)
    props.onRename?.(from, plain(event.destinationPath), pathsUnder(filePaths(), from))
  }

  const remove = (path: string) => {
    const tree = model()
    if (!tree) return
    const target = plain(path)
    tree.remove(folderSet().has(target) ? asFolder(target) : target, { recursive: true })
    props.onDelete?.(target, pathsUnder(filePaths(), target))
  }

  const dropFolder = (context: FileTreeDropContext) => plain(context.target.directoryPath ?? ROOT)

  const canMove = (from: string, folder: string) => {
    const source = plain(from)
    if (source === HOME) return false
    if (isFolderPath(from) && (folder === source || folder.startsWith(`${source}/`))) return false
    if (dirname(source) === folder) return false
    return inHome(source) === inHome(folder)
  }

  const canDrop = (context: FileTreeDropContext) =>
    context.draggedPaths.every((path) => canMove(path, dropFolder(context)))

  const onDropComplete = (context: FileTreeDropContext) => {
    const folder = dropFolder(context)
    for (const path of context.draggedPaths) props.onMove?.(plain(path), join(folder, basename(plain(path))))
  }

  const menuTarget = createMemo<MenuTarget | null>(() => {
    const path = menuPath()
    if (path === null) return null
    return { kind: isFolderPath(path) ? "directory" : "file", path }
  })

  const toggleAll = () => {
    const tree = model()
    if (!tree) return
    const open = !(allOpen() || allExpanded())
    setAllOpen(open)
    setAllDirectoriesExpanded(tree, directories(), open)
  }

  const refresh = () => {
    if (refreshing()) return
    setRefreshing(true)
    const roomId = props.roomId as RoomId
    const cache = owner.cachedRoomAtom(roomId)
    let waiting = 2
    const done = () => {
      if (--waiting > 0) return
      for (const stop of refreshStops.splice(0)) stop()
      setRefreshing(false)
    }
    refreshStops = [registry.subscribe(cache, done), registry.subscribe(owner.userAtom, done)]
    registry.refresh(cache)
    registry.refresh(owner.userAtom)
  }

  const stopRefresh = () => {
    for (const stop of refreshStops.splice(0)) stop()
    setRefreshing(false)
  }

  const search = (value: string) => {
    setQuery(value)
    const tree = model()
    if (!tree) return
    if (value.trim()) tree.setSearch(value)
    else tree.closeSearch()
  }

  const onSelectionChange = (paths: readonly string[]) => {
    if (syncingSelection || dragging) return
    const path = paths.at(-1)
    if (path && !isFolderPath(path) && fileByPath().has(path)) openPath(path)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTyping(event) || event.metaKey || event.ctrlKey) return
    if (event.key !== "Delete" && event.key !== "Backspace") return
    const path = model()?.getFocusedPath()
    if (!path || plain(path) === HOME) return
    event.preventDefault()
    setConfirming(plain(path))
  }

  const onDragStart = (event: DragEvent) => {
    const path = itemPathOf(event)
    if (!path || !event.dataTransfer) return
    dragging = true
    setFileDrag(event.dataTransfer, path)
    if (isFolderPath(path)) event.dataTransfer.setData("text/plain", path)
  }

  const afterRenameKey = (event: Event) => {
    if (isTyping(event)) queueMicrotask(settlePending)
  }

  onMount(() => {
    const tree = new Pierre({
      paths: wanted(),
      density: "compact",
      flattenEmptyDirectories: true,
      initialExpansion: "closed",
      initialExpandedPaths: loadExpanded(props.roomId, storage()).map(asFolder),
      icons: PIERRE_ICONS,
      search: false,
      fileTreeSearchMode: "hide-non-matches",
      unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
      dragAndDrop: { canDrag: (paths) => !paths.some((path) => plain(path) === HOME), canDrop, onDropComplete },
      renaming: {
        canRename: (item) => plain(item.path) !== HOME,
        onRename,
        onError: (error) => showToastV2({ title: error, variant: "error" }),
      },
      onSelectionChange,
    })
    held = new Set(wanted())
    const pick = (event: MouseEvent) => setMenuPath(itemPathOf(event))
    host.addEventListener("contextmenu", pick, true)
    onCleanup(() => host.removeEventListener("contextmenu", pick, true))
    tree.render({ containerWrapper: host })
    wasExpanded = expandedNow(tree)
    savedExpanded = [...wasExpanded].sort().join("\n")
    const stop = tree.subscribe(() => {
      setVersion((value) => value + 1)
      watchExpansion(tree)
    })
    setModel(tree)
    onCleanup(() => {
      stop()
      tree.cleanUp()
    })
  })

  onCleanup(stopRefresh)

  createEffect(
    on([wanted, model], ([next]) => {
      const tree = model()
      if (!tree) return
      held = syncTree(tree, held, new Set(next), pending)
    }),
  )

  createEffect(
    on(
      () => props.files.map((f) => [f.name.replace(/^\/+/, ""), f.size] as const),
      (files) => {
        const next = new Map(fresh())
        for (const [path, size] of files) {
          if (seeded && sizes.get(path) !== size) next.set(path, Date.now())
          sizes.set(path, size)
        }
        for (const path of sizes.keys()) if (!files.some(([name]) => name === path)) sizes.delete(path)
        for (const path of next.keys()) if (!sizes.has(path)) next.delete(path)
        seeded = true
        setFresh(next)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const tree = model()
    if (!tree) return
    const seen = opened()
    tree.setGitStatus(
      [...fresh().keys()].filter((path) => !seen.has(path)).map((path) => ({ path, status: "modified" as const })),
    )
  })

  createEffect(
    on(folderSet, () => {
      const tree = model()
      if (tree && allOpen()) setAllDirectoriesExpanded(tree, directories(), true)
    }),
  )

  createEffect(
    on(
      () => [props.active, props.revealId ?? 0, model()] as const,
      ([path, id]) => {
        if (!path) {
          handledReveal = null
          return
        }
        if (handledReveal?.path === path && handledReveal.id === id) return
        if (treeSelection === path) {
          handledReveal = { path, id }
          return
        }
        treeSelection = null
        if (!model()?.getItem(path)) return
        handledReveal = { path, id }
        setQuery("")
        model()?.closeSearch()
        select(path, false)
      },
    ),
  )

  createEffect(
    on(
      () => props.roomId,
      () => search(""),
      { defer: true },
    ),
  )

  props.ref?.({
    newFile: () => startNew("file"),
    newFolder: () => startNew("folder"),
    toggleAll,
  })

  return (
    <div class="kt-root" data-component="file-tree">
      <div
        class="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-[var(--stroke-tertiary)] px-2 in-data-[panel-mode=inline]:mb-1 in-data-[panel-mode=inline]:h-9 in-data-[panel-mode=inline]:min-h-9 in-data-[panel-mode=inline]:border-b-transparent"
        data-component="file-tree-toolbar"
      >
        <TooltipV2 placement="bottom" openDelay={400} value={refreshing() ? "Refreshing…" : "Refresh files"}>
          <button
            type="button"
            class={TOOL}
            aria-label="Refresh files"
            aria-busy={refreshing()}
            data-action="refresh-files"
            onClick={refresh}
          >
            <RemixIcon icon={ResetIcon} size={14} class={refreshing() ? "motion-spin" : undefined} />
          </button>
        </TooltipV2>
        <input
          type="search"
          name="files-search"
          class="kt-search"
          aria-label="Search files"
          placeholder="Search files"
          spellcheck={false}
          autocomplete="off"
          value={query()}
          ref={props.focusSearch ? (input) => queueMicrotask(() => input.focus()) : undefined}
          onInput={(event) => search(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            search("")
            event.currentTarget.blur()
          }}
        />
        <Show when={directories().length > 0}>
          <TooltipV2
            placement="bottom"
            openDelay={400}
            value={allOpen() || allExpanded() ? "Collapse all folders" : "Expand all folders"}
          >
            <button
              type="button"
              class={TOOL}
              aria-label={allOpen() || allExpanded() ? "Collapse all folders" : "Expand all folders"}
              aria-pressed={allOpen() || allExpanded()}
              data-action="toggle-all-folders"
              onClick={toggleAll}
            >
              <FolderToggleIcon open={allOpen() || allExpanded()} />
            </button>
          </TooltipV2>
        </Show>
      </div>
      <Show when={noMatches()}>
        <p role="status" class="type-sm px-3 py-4 text-tertiary">
          No files match
        </p>
      </Show>
      <Show when={wanted().length === 0}>
        <Empty />
      </Show>
      <MenuV2.Context gutter={6}>
        <MenuV2.Context.Trigger
          as="div"
          ref={host}
          class="kt-host"
          data-hidden={noMatches() || wanted().length === 0 ? "" : undefined}
          aria-label="Files"
          onKeyDown={onKeyDown}
          onKeyUp={afterRenameKey}
          onFocusOut={afterRenameKey}
          onDragStart={onDragStart}
          onDragEnd={() => (dragging = false)}
        />
        <MenuV2.Context.Portal>
          <MenuV2.Context.Content
            class="min-w-48"
            data-component="file-tree-menu"
            onCloseAutoFocus={(event: Event) => {
              event.preventDefault()
              focusRename(0)
            }}
          >
            <Show
              when={menuTarget()}
              keyed
              fallback={
                <>
                  <MenuV2.Item onSelect={() => startNew("file", ROOT)}>New file</MenuV2.Item>
                  <MenuV2.Item onSelect={() => startNew("folder", ROOT)}>New folder</MenuV2.Item>
                </>
              }
            >
              {(target) => (
                <>
                  <Show when={target.kind === "file"}>
                    <MenuV2.Item onSelect={() => openPath(target.path)}>Open</MenuV2.Item>
                    <MenuV2.Item onSelect={() => openPathInTab(target.path)}>Open in new tab</MenuV2.Item>
                    <MenuV2.Item onSelect={() => select(target.path, true)}>Reveal in Files</MenuV2.Item>
                    <MenuV2.Separator />
                    <MenuV2.Item onSelect={() => addToChat(target.path)}>Add to chat</MenuV2.Item>
                    <MenuV2.Item onSelect={() => copyMention(target.path)}>Copy mention</MenuV2.Item>
                    <MenuV2.Separator />
                    <MenuV2.Item onSelect={() => copyPath(target.path)}>Copy path</MenuV2.Item>
                    <MenuV2.Item onSelect={() => download(target.path)}>
                      <RemixIcon icon={DownloadIcon} class="size-4 shrink-0" />
                      Download
                    </MenuV2.Item>
                    <MenuV2.Separator />
                  </Show>
                  <Show when={target.kind === "directory"}>
                    <MenuV2.Item onSelect={() => startNew("file", plain(target.path))}>New file</MenuV2.Item>
                    <MenuV2.Item onSelect={() => startNew("folder", plain(target.path))}>New folder</MenuV2.Item>
                    <MenuV2.Separator />
                    <MenuV2.Item onSelect={() => copyPath(target.path)}>Copy path</MenuV2.Item>
                    <Show when={plain(target.path) !== HOME}>
                      <MenuV2.Separator />
                    </Show>
                  </Show>
                  <Show when={plain(target.path) !== HOME}>
                    <MenuV2.Item onSelect={() => beginRename(target.path)}>Rename</MenuV2.Item>
                    <MenuV2.Item onSelect={() => setConfirming(plain(target.path))}>Delete</MenuV2.Item>
                  </Show>
                </>
              )}
            </Show>
          </MenuV2.Context.Content>
        </MenuV2.Context.Portal>
      </MenuV2.Context>
      <Dialog
        open={confirming() !== null}
        onClose={() => setConfirming(null)}
        title={`Delete ${confirming() === null ? "this" : basename(confirming()!)}?`}
        description={
          confirming() !== null && folderSet().has(confirming()!)
            ? "The folder and everything inside it goes away."
            : "The file goes away from this chat."
        }
        data-component="file-tree-delete"
        footer={
          <>
            <Button variant="ghost" data-action="cancel-file-delete" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              data-action="confirm-file-delete"
              onClick={() => {
                const path = confirming()
                setConfirming(null)
                if (path) remove(path)
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  )
}

function Empty(): JSX.Element {
  return (
    <div class="kt-empty" data-component="file-tree-empty">
      <Pictogram name="files" size={32} />
      <p class="type-sm">No files yet. What the agents make shows up here.</p>
    </div>
  )
}
