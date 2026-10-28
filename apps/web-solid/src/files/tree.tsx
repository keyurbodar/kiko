import { SearchField } from "@kiko/ui/v2/search-field"
import type { FileRef } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import {
  FILE_TREE_TAG_NAME,
  FileTree as Pierre,
  type ContextMenuItem as FileTreeContextMenuItem,
  type ContextMenuOpenContext as FileTreeContextMenuOpenContext,
} from "@pierre/trees"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { setFileDrag } from "../lib/file-drag"
import "./tree.css"
import { createParent, dirname, HOME, join, loadExpanded, pathsUnder, ROOT, saveExpanded } from "./model"
import { KIKO_FILE_ICONS } from "../lib/entry-icon-pierre"
import { syncTree } from "./tree-sync"

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
  onNewFolder?: (path: string) => void
  active?: string | null
  onOpen?: (path: string) => void
  onNewFile?: (path: string) => void
  onRename?: (from: string, to: string, paths: string[]) => void
  onDelete?: (path: string, paths: string[]) => void
  searchOpen?: boolean
}

const asFolder = (path: string) => `${path.replace(/\/+$/, "")}/`
const plain = (path: string) => path.replace(/\/+$/, "")

const TREE_CSS = `
	:host {
		--trees-bg-override: transparent;
		--trees-fg-override: var(--fg);
		--trees-bg-muted-override: var(--hover);
		--trees-selected-bg-override: var(--active);
		--trees-selected-fg-override: var(--fg);
		--trees-border-color-override: var(--border-100);
		--trees-indent-guide-bg-override: var(--border-100);
		--trees-font-family-override: var(--font-family-sans);
		--trees-font-size-override: var(--type-label);
		--trees-fg-muted-override: var(--text-300);
		--trees-border-radius-override: var(--radius-row);
		--trees-level-gap-override: 14px;
		--trees-icon-width-override: 15px;
		--trees-item-row-gap-override: 6px;
		--trees-padding-inline-override: 8px;
		--trees-selected-focused-border-color-override: transparent;
		--trees-focus-ring-color-override: transparent;
	}
	button[data-type='item'], button[data-type='item']::before { border-radius: var(--radius-row); }
	button[data-type='item'] [data-item-section='spacing-item'] { opacity: 1; }
	button[data-type='item'] [data-item-section='icon'] > [data-icon-name='file-tree-icon-chevron'] { width: 13px; height: 13px; color: var(--text-300); }
	button[data-type='item'][data-item-selected='true'] [data-item-section='icon'] > [data-icon-name='file-tree-icon-chevron'] { color: var(--fg); }
	svg[data-icon-name='t3-tree-icon-loading'] { opacity: 0.6; }
	@media (prefers-reduced-motion: no-preference) {
		svg[data-icon-name='t3-tree-icon-loading'] { animation: t3-tree-spin 1s linear infinite; }
	}
	@keyframes t3-tree-spin { to { transform: rotate(360deg); } }
`

export function FileTree(props: FileTreeProps): JSX.Element {
  let host!: HTMLDivElement
  let tree: Pierre | undefined
  let syncing = false
  let touched: string | null = null
  const watchers = new Map<string, () => void>()
  const pending = new Map<string, "file" | "folder">()
  const [query, setQuery] = createSignal("")

  const filePaths = createMemo(() => props.files.map((f) => f.name.replace(/^\/+/, "")))
  const folderPaths = createMemo(() => (props.folders ?? []).map((f) => plain(f.replace(/^\/+/, ""))).filter(Boolean))
  const wanted = createMemo(() => [...filePaths(), ...folderPaths().map(asFolder)])
  let held = new Set<string>()

  const folderSet = () => {
    const out = new Set(folderPaths())
    for (const path of filePaths()) for (let dir = dirname(path); dir !== ROOT; dir = dirname(dir)) out.add(dir)
    return out
  }

  const parentForNew = () => {
    const path = touched && tree?.getItem(touched) ? touched : tree?.getSelectedPaths().at(-1)
    return createParent(path)
  }

  const freshName = (parent: string, kind: "file" | "folder") => {
    const taken = new Set(wanted().map(plain))
    for (let n = 1; ; n++) {
      const name =
        kind === "folder" ? (n === 1 ? "new folder" : `new folder ${n}`) : n === 1 ? "untitled" : `untitled ${n}`
      if (!taken.has(join(parent, name))) return name
    }
  }

  const watchNew = (id: string, kind: "file" | "folder") => {
    const root = host.querySelector(FILE_TREE_TAG_NAME)?.shadowRoot
    if (!root) return
    const input = () => root.querySelector("[data-item-rename-input]")
    let seen = false
    let escaped = false
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") escaped = true
    }
    host.addEventListener("keydown", onKey, true)
    let stopWatching: MutationObserver
    function stop() {
      stopWatching.disconnect()
      host.removeEventListener("keydown", onKey, true)
      watchers.delete(id)
    }
    stopWatching = new MutationObserver(() => {
      if (input()) return void (seen = true)
      if (!seen) return
      stop()
      if (!pending.delete(id)) return
      if (!tree?.getItem(id)) {
        if (!escaped) showToastV2({ title: "A name can't be empty", variant: "error" })
        return
      }
      created(id, kind)
    })
    stopWatching.observe(root, { childList: true, subtree: true })
    watchers.set(id, stop)
  }

  function created(id: string, kind: "file" | "folder") {
    touched = id
    if (kind === "folder") props.onNewFolder?.(plain(id))
    else props.onNewFile?.(plain(id))
  }

  const quietly = <T,>(run: () => T): T => {
    syncing = true
    try {
      return run()
    } finally {
      syncing = false
    }
  }

  const beginNew = (id: string, kind: "file" | "folder") => {
    if (!quietly(() => tree?.startRenaming(id, { removeIfCanceled: true }))) return false
    watchNew(id, kind)
    return true
  }

  const refused = (error: string) => {
    showToastV2({ title: error, variant: "error" })
    for (const [id, kind] of pending) {
      if (!tree?.getItem(id)) continue
      watchers.get(id)?.()
      queueMicrotask(() => {
        if (!beginNew(id, kind)) return
        requestAnimationFrame(() =>
          host
            .querySelector(FILE_TREE_TAG_NAME)
            ?.shadowRoot?.querySelector<HTMLInputElement>("[data-item-rename-input]")
            ?.select(),
        )
      })
    }
  }

  const startNew = (kind: "file" | "folder", parent = parentForNew()) => {
    if (!tree) return
    if (parent !== ROOT) {
      const dir = tree.getItem(asFolder(parent))
      if (dir?.isDirectory() && "expand" in dir) dir.expand()
    }
    const path = join(parent, freshName(parent, kind))
    const id = kind === "folder" ? asFolder(path) : path
    pending.set(id, kind)
    tree.add(id)
    if (!beginNew(id, kind)) pending.delete(id)
  }

  const remove = (path: string) => {
    if (!tree) return
    const under = pathsUnder(filePaths(), plain(path))
    tree.remove(path, { recursive: true })
    props.onDelete?.(plain(path), under)
  }

  const menu = (item: FileTreeContextMenuItem, ctx: FileTreeContextMenuOpenContext): HTMLElement => {
    const root = document.createElement("div")
    root.className = "kt-menu"
    root.setAttribute("role", "menu")
    root.dataset.fileTreeContextMenuRoot = "true"
    const add = (label: string, run: () => void) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "kt-menu-item"
      button.setAttribute("role", "menuitem")
      button.textContent = label
      button.addEventListener("click", () => {
        ctx.close({ restoreFocus: false })
        run()
      })
      root.append(button)
    }
    const sep = () => {
      const line = document.createElement("div")
      line.className = "kt-menu-sep"
      root.append(line)
    }
    const isHome = plain(item.path) === HOME
    if (item.kind === "directory") {
      add("New file", () => startNew("file", createParent(item.path)))
      add("New folder", () => startNew("folder", createParent(item.path)))
      if (!isHome) sep()
    }
    if (!isHome) {
      add("Rename", () => void quietly(() => tree?.startRenaming(item.path)))
      add("Delete", () => remove(item.path))
    }
    return root
  }

  onMount(() => {
    const expanded = loadExpanded(props.roomId, storage()).map(asFolder)
    const instance = new Pierre({
      paths: wanted(),
      icons: KIKO_FILE_ICONS,
      itemHeight: 32,
      flattenEmptyDirectories: true,
      initialExpansion: "closed",
      initialExpandedPaths: expanded,
      fileTreeSearchMode: "hide-non-matches",
      search: false,
      dragAndDrop: { canDrag: () => false, canDrop: () => false },
      renaming: {
        canRename: (item) => plain(item.path) !== HOME,
        onError: refused,
        onRename: (event) =>
          queueMicrotask(() => {
            const from = plain(event.sourcePath)
            const to = plain(event.destinationPath)
            const key = pending.has(event.sourcePath) ? event.sourcePath : asFolder(from)
            const kind = pending.get(key)
            if (kind) {
              pending.delete(key)
              created(kind === "folder" ? asFolder(to) : to, kind)
              return
            }
            props.onRename?.(from, to, pathsUnder(filePaths(), from))
          }),
      },
      composition: { contextMenu: { triggerMode: "right-click", render: menu } },
      onSelectionChange: (selected) => {
        if (syncing) return
        const path = selected.at(-1)
        if (path?.endsWith("/") && !pending.has(path)) {
          syncing = true
          tree?.getItem(path)?.deselect()
          syncing = false
          return
        }
        if (path && !path.endsWith("/") && !pending.has(path) && filePaths().includes(path)) props.onOpen?.(path)
      },
      unsafeCSS: TREE_CSS,
    })
    tree = instance
    held = new Set(wanted())
    instance.render({ containerWrapper: host })
    const rowPath = (event: Event) =>
      event
        .composedPath()
        .find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset.itemPath !== undefined)
        ?.dataset.itemPath
    const dragFile = (event: DragEvent) => {
      event.stopPropagation()
      const path = rowPath(event)
      const known =
        path !== undefined && (filePaths().includes(path) || folderPaths().some((dir) => `${dir}/` === path))
      if (!known || !event.dataTransfer) return event.preventDefault()
      setFileDrag(event.dataTransfer, path)
    }
    host.addEventListener("dragstart", dragFile, true)
    const touch = (event: Event) => {
      touched = rowPath(event) ?? touched
    }
    const pointer = () => host.setAttribute("data-pointer", "")
    const keyboard = () => host.removeAttribute("data-pointer")
    host.addEventListener("click", touch)
    host.addEventListener("focusin", touch)
    host.addEventListener("pointerdown", pointer, true)
    host.addEventListener("keydown", keyboard, true)

    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = instance.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const open: string[] = []
        for (const dir of folderSet()) {
          const item = instance.getItem(asFolder(dir))
          if (item?.isDirectory() && "isExpanded" in item && item.isExpanded()) open.push(dir)
        }
        saveExpanded(props.roomId, storage(), open)
      }, 250)
    })
    onCleanup(() => {
      host.removeEventListener("dragstart", dragFile, true)
      host.removeEventListener("click", touch)
      host.removeEventListener("focusin", touch)
      host.removeEventListener("pointerdown", pointer, true)
      host.removeEventListener("keydown", keyboard, true)
      stop()
      for (const stop of Array.from(watchers.values())) stop()
      clearTimeout(timer)
      instance.unmount()
      tree = undefined
    })
  })

  createEffect(
    on(wanted, (next) => {
      if (tree) held = syncTree(tree, held, new Set(next), pending)
    }),
  )

  createEffect(
    on(
      () => props.roomId,
      () => setQuery(""),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.active,
      (path) => {
        const item = path ? tree?.getItem(path) : null
        if (!item || item.isSelected()) return
        syncing = true
        item.select()
        syncing = false
      },
    ),
  )

  createEffect(() => {
    if (props.searchOpen === false) setQuery("")
    const q = query().trim()
    tree?.setSearch(q || null)
  })

  const [allOpen, setAllOpen] = createSignal(false)
  const toggleAll = () => {
    const open = !allOpen()
    for (const dir of folderSet()) {
      const item = tree?.getItem(asFolder(dir))
      if (item?.isDirectory() && "expand" in item) {
        if (open) item.expand()
        else item.collapse()
      }
    }
    setAllOpen(open)
  }

  props.ref?.({ newFile: () => startNew("file"), newFolder: () => startNew("folder"), toggleAll })

  return (
    <div class="kt-root" data-component="file-tree">
      <Show when={props.searchOpen !== false}>
        <div class="kt-bar">
          <SearchField
            wrapClass="min-w-0 flex-1"
            aria-label="Search files"
            placeholder="Search files"
            spellcheck={false}
            autocomplete="off"
            value={query()}
            ref={(input) => queueMicrotask(() => input.focus())}
            onValue={setQuery}
          />
        </div>
      </Show>
      <div class="kt-host" ref={host} role="region" aria-label="Files" />
      <Show when={wanted().length === 0}>
        <div class="kt-empty">No files yet. Agents save what they make here, and + adds one.</div>
      </Show>
    </div>
  )
}

function storage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
