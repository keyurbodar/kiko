import { fileName, type FileRef } from "@kiko/protocol"
import { fileTone } from "@kiko/ui/file-icon"
import { ChevronRightIcon, FolderIcon, FolderOpenIcon } from "@kiko/ui/icons"
import { Pictogram } from "@kiko/ui/pictogram"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { SearchField } from "@kiko/ui/v2/search-field"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { FileTree as Pierre, type FileTreeVisibleRow } from "@pierre/trees"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Dialog } from "../lib/dialog"
import { setFileDrag } from "../lib/file-drag"
import { Button } from "../settings/kit"
import { editedText } from "./edited"
import {
  basename,
  createParent,
  dirname,
  HOME,
  join,
  loadExpanded,
  pathsUnder,
  ROOT,
  saveExpanded,
  VIRTUALIZE_AFTER,
} from "./model"
import { syncTree } from "./tree-sync"
import { fileType } from "./type"
import { TypeIcon } from "./type-icon"
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
  searchOpen?: boolean
  onOpen?: (path: string) => void
  onNewFile?: (path: string) => void
  onNewFolder?: (path: string) => void
  onRename?: (from: string, to: string, paths: string[]) => void
  onDelete?: (path: string, paths: string[]) => void
  onMove?: (from: string, to: string) => void
}

type Editing = { path: string; kind: "file" | "folder"; isNew: boolean }
type Edges = { top: boolean; bottom: boolean }
type MenuTarget = { kind: "directory" | "file"; path: string }

const GUIDE_GAP = 14
const GUIDE_BASE = 8 + 7
const INDENT = 8
const OVERSCAN = 8
const TYPE_AHEAD_MS = 600
const ROW_FALLBACK = 28

const asFolder = (path: string) => `${path.replace(/\/+$/, "")}/`
const plain = (path: string) => path.replace(/\/+$/, "")
const isFolderPath = (path: string) => path.endsWith("/")
const trimName = (name: string) => name.trim().replace(/^\/+|\/+$/g, "")
const guideLeft = (level: number) => GUIDE_BASE + level * GUIDE_GAP

const descendantFolders = (folders: Iterable<string>, path: string) =>
  [...folders].filter((dir) => dir === path || dir.startsWith(`${path}/`))

const tintOf = (path: string) => {
  const tone = fileTone(path)
  return tone ? `light-dark(${tone[0]}, ${tone[1]})` : "var(--text-300)"
}

function storage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function FileTree(props: FileTreeProps): JSX.Element {
  let scroller!: HTMLDivElement
  let list!: HTMLDivElement
  let renameInput: HTMLInputElement | undefined
  let selectedOnce = false
  let rowHeight = ROW_FALLBACK
  let held = new Set<string>()
  let anchor: { path: string; offset: number } | null = null
  let typed = ""
  let typedAt = 0
  const sizes = new Map(props.files.map((file) => [file.name.replace(/^\/+/, ""), file.size]))
  let seeded = props.files.length > 0
  const pending = new Map<string, "file" | "folder">()

  const [model, setModel] = createSignal<Pierre>()
  const [version, setVersion] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal<string | null>(props.active ?? null)
  const [focused, setFocused] = createSignal<string | null>(null)
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewport, setViewport] = createSignal(0)
  const [edges, setEdges] = createSignal<Edges>({ top: false, bottom: false })
  const [entering, setEntering] = createSignal<ReadonlySet<string>>(new Set())
  const [fresh, setFresh] = createSignal<ReadonlyMap<string, number>>(new Map())
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = createSignal<Editing | null>(null)
  const [draft, setDraft] = createSignal("")
  const [confirming, setConfirming] = createSignal<string | null>(null)
  const [dragging, setDragging] = createSignal<string | null>(null)
  const [dropTarget, setDropTarget] = createSignal<string | null>(null)
  const [menuPath, setMenuPath] = createSignal<string | null>(null)
  const [allOpen, setAllOpen] = createSignal(false)

  const filePaths = createMemo(() => props.files.map((f) => f.name.replace(/^\/+/, "")))
  const fileByPath = createMemo(() => new Map(filePaths().map((path, index) => [path, props.files[index]!])))
  const folderPaths = createMemo(() => (props.folders ?? []).map((f) => plain(f.replace(/^\/+/, ""))).filter(Boolean))
  const folderSet = createMemo(() => {
    const out = new Set(folderPaths())
    for (const path of filePaths()) for (let dir = dirname(path); dir !== ROOT; dir = dirname(dir)) out.add(dir)
    return out
  })
  const wanted = createMemo(() => [...filePaths(), ...folderPaths().map(asFolder)])

  const rows = createMemo<readonly FileTreeVisibleRow[]>(() => {
    const tree = model()
    if (!tree) return []
    version()
    const count = tree.getVisibleCount()
    return count === 0 ? [] : tree.getVisibleRows(0, count - 1)
  })

  const brightGuide = createMemo(() => {
    const path = selected()
    return path ? dirname(plain(path)) : null
  })

  const windowRows = createMemo(() => {
    const all = rows()
    if (all.length <= VIRTUALIZE_AFTER) return { start: 0, rows: all }
    const first = Math.max(0, Math.floor(scrollTop() / rowHeight) - OVERSCAN)
    const last = Math.min(all.length, Math.ceil((scrollTop() + Math.max(viewport(), rowHeight)) / rowHeight) + OVERSCAN)
    return { start: first, rows: all.slice(first, last) }
  })

  const focusedIndex = createMemo(() => rows().findIndex((row) => row.path === focused()))
  const fade = () => [edges().top ? "top" : "", edges().bottom ? "bottom" : ""].filter(Boolean).join(" ")

  const bump = () => setVersion((value) => value + 1)

  const measure = () => {
    if (!scroller) return
    const max = scroller.scrollHeight - scroller.clientHeight
    const top = scroller.scrollTop
    setScrollTop(top)
    setViewport(scroller.clientHeight)
    setEdges({ top: top > 0.5, bottom: top < max - 0.5 })
  }

  const rememberAnchor = () => {
    if (!scroller) return
    const all = rows()
    if (!all.length) return
    const at = Math.max(0, scroller.scrollTop)
    const index = Math.min(all.length - 1, Math.floor(at / rowHeight))
    anchor = { path: all[index]!.path, offset: at - index * rowHeight }
  }

  const restoreAnchor = (next: readonly FileTreeVisibleRow[]) => {
    if (anchor && scroller) {
      let index = next.findIndex((row) => row.path === anchor!.path)
      if (index < 0) {
        for (let dir = dirname(plain(anchor.path)); index < 0 && dir !== ROOT; dir = dirname(dir))
          index = next.findIndex((row) => plain(row.path) === dir)
      }
      if (index >= 0) {
        const kept = next[index]!.path === anchor.path
        scroller.scrollTop = index * rowHeight + (kept ? anchor.offset : 0)
      }
    }
    measure()
  }

  const reveal = (path: string) => {
    if (!scroller) return
    const index = rows().findIndex((row) => row.path === path)
    if (index < 0) return
    const top = index * rowHeight
    const bottom = top + rowHeight
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight
    measure()
  }

  const expandAncestors = (path: string) => {
    const tree = model()
    if (!tree) return
    for (let dir = dirname(plain(path)); dir !== ROOT; dir = dirname(dir)) {
      const item = tree.getItem(asFolder(dir))
      if (item?.isDirectory() && "isExpanded" in item && !item.isExpanded()) item.expand()
    }
    bump()
  }

  const parentForNew = () => {
    const at = focused() ?? selected()
    if (at && model()?.getItem(at)) return createParent(at)
    return ROOT
  }

  const freshName = (parent: string, kind: "file" | "folder") => {
    const taken = new Set(wanted().map(plain))
    for (let n = 1; ; n++) {
      const name =
        kind === "folder" ? (n === 1 ? "new folder" : `new folder ${n}`) : n === 1 ? "untitled" : `untitled ${n}`
      if (!taken.has(join(parent, name))) return name
    }
  }

  const persist = () => {
    const tree = model()
    if (!tree) return
    const open: string[] = []
    for (const dir of folderSet()) {
      const item = tree.getItem(asFolder(dir))
      if (item?.isDirectory() && "isExpanded" in item && item.isExpanded()) open.push(dir)
    }
    saveExpanded(props.roomId, storage(), open)
  }

  const toggleFold = (path: string, subtree: boolean) => {
    const tree = model()
    if (!tree) return
    const item = tree.getItem(path)
    if (!item?.isDirectory() || !("isExpanded" in item)) return
    const open = !item.isExpanded()
    for (const dir of subtree ? descendantFolders(folderSet(), plain(path)) : [plain(path)]) {
      const handle = tree.getItem(asFolder(dir))
      if (handle?.isDirectory() && "expand" in handle) {
        if (open) handle.expand()
        else handle.collapse()
      }
    }
    bump()
    persist()
  }

  const markOpened = (path: string) => setOpened(new Set([...opened(), path]))

  const openPath = (path: string) => {
    if (isFolderPath(path)) return
    setSelected(path)
    setFocused(path)
    markOpened(path)
    props.onOpen?.(path)
  }

  const revealInFiles = (path: string) => {
    expandAncestors(path)
    setSelected(path)
    setFocused(path)
    queueMicrotask(() => reveal(path))
  }

  const copyPath = (path: string) => {
    void navigator.clipboard
      .writeText(plain(path))
      .then(() => showToastV2({ title: "Path copied", variant: "success" }))
      .catch(() => showToastV2({ title: "Could not copy the path", variant: "error" }))
  }

  const beginRename = (path: string, isNew = false) => {
    selectedOnce = false
    setDraft(basename(plain(path)))
    setEditing({ path, kind: isFolderPath(path) ? "folder" : "file", isNew })
  }

  const focusRename = (attempt: number) => {
    const input = renameInput
    if (!input || !editing() || document.activeElement === input) return
    input.focus()
    if (document.activeElement !== input && attempt < 10) setTimeout(() => focusRename(attempt + 1), 40)
  }

  const createNew = (edit: Editing, to: string) => {
    const tree = model()
    if (!tree) return
    pending.delete(edit.path)
    if (tree.getItem(to)) return showToastV2({ title: "That name is taken", variant: "error" })
    if (to !== edit.path) {
      tree.remove(edit.path, { recursive: true })
      tree.add(to)
    }
    bump()
    persist()
    if (edit.kind === "folder") props.onNewFolder?.(plain(to))
    else props.onNewFile?.(to)
  }

  const rename = (edit: Editing, to: string) => {
    const tree = model()
    if (!tree) return
    if (tree.getItem(to)) return showToastV2({ title: "That name is taken", variant: "error" })
    tree.move(edit.path, to)
    bump()
    persist()
    props.onRename?.(plain(edit.path), plain(to), pathsUnder(filePaths(), plain(edit.path)))
  }

  const cancelNew = (edit: Editing) => {
    pending.delete(edit.path)
    const tree = model()
    if (!tree) return
    tree.remove(edit.path, { recursive: true })
    bump()
  }

  const commitRename = () => {
    const edit = editing()
    if (!edit) return
    setEditing(null)
    const name = trimName(draft())
    if (!name) {
      if (!edit.isNew) return showToastV2({ title: "A name can't be empty", variant: "error" })
      cancelNew(edit)
      return
    }
    const to = edit.kind === "folder" ? asFolder(join(dirname(edit.path), name)) : join(dirname(edit.path), name)
    if (edit.isNew) return createNew(edit, to)
    if (to !== edit.path) rename(edit, to)
  }

  const cancelRename = () => {
    const edit = editing()
    setEditing(null)
    if (edit?.isNew) cancelNew(edit)
  }

  const startNew = (kind: "file" | "folder", parent = parentForNew()) => {
    const tree = model()
    if (!tree) return
    if (parent !== ROOT) {
      const dir = tree.getItem(asFolder(parent))
      if (dir?.isDirectory() && "expand" in dir) dir.expand()
    }
    const path = join(parent, freshName(parent, kind))
    const id = kind === "folder" ? asFolder(path) : path
    pending.set(id, kind)
    tree.add(id)
    bump()
    beginRename(id, true)
  }

  const remove = (path: string) => {
    const tree = model()
    if (!tree) return
    const target = plain(path)
    tree.remove(path, { recursive: true })
    bump()
    persist()
    props.onDelete?.(target, pathsUnder(filePaths(), target))
  }

  const moveTo = (from: string, folder: string) => {
    const source = plain(from)
    if (isFolderPath(from) && (folder === source || folder.startsWith(`${source}/`))) return
    if (dirname(source) === folder) return
    props.onMove?.(source, join(folder, basename(source)))
  }

  const dropFolder = (row: FileTreeVisibleRow) => (row.kind === "directory" ? plain(row.path) : dirname(row.path))

  const menuTarget = createMemo<MenuTarget | null>(() => {
    const path = menuPath()
    if (path === null) return null
    return { kind: isFolderPath(path) ? "directory" : "file", path }
  })

  const toggleAll = () => {
    const tree = model()
    if (!tree) return
    const open = !allOpen()
    for (const dir of folderSet()) {
      const item = tree.getItem(asFolder(dir))
      if (item?.isDirectory() && "expand" in item) {
        if (open) item.expand()
        else item.collapse()
      }
    }
    setAllOpen(open)
    bump()
    persist()
  }

  const moveFocus = (delta: number) => {
    const all = rows()
    if (!all.length) return
    const at = Math.max(
      0,
      all.findIndex((row) => row.path === focused()),
    )
    const next = all[Math.min(all.length - 1, Math.max(0, at + delta))]
    if (!next) return
    setFocused(next.path)
    reveal(next.path)
  }

  const goToParent = (row: FileTreeVisibleRow) => {
    const all = rows()
    for (let index = all.indexOf(row) - 1; index >= 0; index--) {
      const candidate = all[index]!
      if (candidate.level >= row.level) continue
      setFocused(candidate.path)
      reveal(candidate.path)
      return
    }
  }

  const typeAhead = (input: string) => {
    const now = Date.now()
    typed = now - typedAt > TYPE_AHEAD_MS ? input : typed + input
    typedAt = now
    const needle = typed.toLowerCase()
    const all = rows()
    const at = Math.max(
      0,
      all.findIndex((row) => row.path === focused()),
    )
    const ordered = [...all.slice(at + 1), ...all.slice(0, at + 1)]
    const hit = ordered.find((row) => row.name.toLowerCase().startsWith(needle))
    if (!hit) return
    setFocused(hit.path)
    reveal(hit.path)
  }

  const currentRow = () => {
    const all = rows()
    return all.find((item) => item.path === focused()) ?? all[0]
  }

  const moveKey = (key: string) => {
    if (key !== "ArrowDown" && key !== "ArrowUp") return false
    moveFocus(key === "ArrowDown" ? 1 : -1)
    return true
  }

  const foldKey = (key: string, row: FileTreeVisibleRow, subtree: boolean) => {
    const folder = row.kind === "directory"
    if (key === "ArrowRight" && folder && !row.isExpanded) {
      toggleFold(row.path, subtree)
      return true
    }
    if (key === "ArrowRight") return (moveFocus(1), true)
    if (key !== "ArrowLeft") return false
    if (folder && row.isExpanded) toggleFold(row.path, subtree)
    else goToParent(row)
    return true
  }

  const actionKey = (key: string, row: FileTreeVisibleRow, subtree: boolean) => {
    if (key === "Enter") {
      if (row.kind === "directory") toggleFold(row.path, subtree)
      else openPath(row.path)
      return true
    }
    if (key === "F2" && plain(row.path) !== HOME) return (beginRename(row.path), true)
    if (key === "Delete" && plain(row.path) !== HOME) return (setConfirming(plain(row.path)), true)
    if (key.length !== 1 || subtree) return false
    typeAhead(key)
    return true
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (editing() || event.metaKey || event.ctrlKey || event.isComposing) return
    const row = currentRow()
    if (!row) return
    if (!moveKey(event.key) && !foldKey(event.key, row, event.altKey) && !actionKey(event.key, row, event.altKey))
      return
    event.preventDefault()
  }

  const onRowClick = (row: FileTreeVisibleRow, event: MouseEvent) => {
    list.focus({ preventScroll: true })
    setFocused(row.path)
    if (row.kind === "directory") {
      setSelected(row.path)
      toggleFold(row.path, event.altKey)
    } else openPath(row.path)
  }

  const onRowDragOver = (row: FileTreeVisibleRow, event: DragEvent) => {
    const from = dragging()
    const folder = dropFolder(row)
    if (!from) return
    if (isFolderPath(from) && (folder === plain(from) || folder.startsWith(`${plain(from)}/`))) return
    if (dirname(plain(from)) === folder) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
    setDropTarget(folder)
  }

  const onRowDrop = (row: FileTreeVisibleRow, event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const from = dragging()
    setDragging(null)
    setDropTarget(null)
    if (from) moveTo(from, dropFolder(row))
  }

  const onRowDragStart = (row: FileTreeVisibleRow, event: DragEvent) => {
    setDragging(row.path)
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = "copyMove"
    if (row.kind === "file") setFileDrag(event.dataTransfer, row.path)
    else event.dataTransfer.setData("text/plain", row.path)
  }

  const freshAt = (row: FileTreeVisibleRow) => {
    const paths = fresh()
    if (!paths.size) return undefined
    if (row.kind === "file") return paths.get(row.path)
    if (row.isExpanded) return undefined
    for (const [path, at] of paths) if (path.startsWith(row.path)) return at
    return undefined
  }

  const fileOf = (path: string) => fileByPath().get(path) ?? { name: path, type: "" }

  const search = (value: string) => {
    setQuery(value)
    model()?.setSearch(value.trim() || null)
    bump()
    queueMicrotask(() => {
      rememberAnchor()
      measure()
    })
  }

  onMount(() => {
    rowHeight = Number.parseFloat(getComputedStyle(scroller).getPropertyValue("--spacing-step")) || ROW_FALLBACK
    const tree = new Pierre({
      paths: wanted(),
      flattenEmptyDirectories: true,
      initialExpansion: "closed",
      initialExpandedPaths: loadExpanded(props.roomId, storage()).map(asFolder),
      search: false,
      fileTreeSearchMode: "hide-non-matches",
      dragAndDrop: false,
    })
    held = new Set(wanted())
    setModel(tree)
    measure()
    rememberAnchor()
    onCleanup(() => tree.cleanUp())
  })

  createEffect(
    on([wanted, model], ([next]) => {
      const tree = model()
      if (!tree) return
      held = syncTree(tree, held, new Set(next), pending)
      bump()
    }),
  )

  createEffect(
    on(
      rows,
      (next, prev) => {
        const before = new Set((prev ?? []).map((row) => row.path))
        setEntering(new Set(next.filter((row) => !before.has(row.path)).map((row) => row.path)))
        restoreAnchor(next)
      },
      { defer: true },
    ),
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

  createEffect(
    on(
      () => props.active,
      (path) => {
        if (!path) return
        setSelected(path)
        setFocused(path)
        expandAncestors(path)
        queueMicrotask(() => reveal(path))
      },
    ),
  )

  createEffect(
    on(
      () => props.roomId,
      () => {
        setQuery("")
        model()?.setSearch(null)
        bump()
      },
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
            onValue={search}
          />
        </div>
      </Show>
      <Show when={wanted().length > 0} fallback={<Empty />}>
        <MenuV2.Context gutter={6}>
          <MenuV2.Context.Trigger as="div" class="kt-body">
            <div
              ref={scroller}
              class="kt-scroller"
              data-fade={fade()}
              onScroll={() => {
                rememberAnchor()
                measure()
              }}
              onContextMenu={(event: MouseEvent) => {
                if (event.target === event.currentTarget) setMenuPath(null)
              }}
              onDragOver={(event: DragEvent) => {
                if (!dragging()) return
                event.preventDefault()
                setDropTarget(ROOT)
              }}
              onDrop={() => {
                const from = dragging()
                setDragging(null)
                setDropTarget(null)
                if (from) moveTo(from, ROOT)
              }}
            >
              <div
                ref={list}
                role="tree"
                aria-label="Files"
                aria-activedescendant={focusedIndex() >= 0 ? `ft-row-${focusedIndex()}` : undefined}
                tabIndex={0}
                class="kt-list"
                onKeyDown={onKeyDown}
                onFocus={() => {
                  if (!focused() && rows()[0]) setFocused(rows()[0]!.path)
                }}
              >
                <div style={{ height: `${windowRows().start * rowHeight}px` }} />
                <For each={windowRows().rows}>
                  {(row, index) => {
                    const at = () => windowRows().start + index()
                    const folder = row.kind === "directory"
                    return (
                      <div
                        id={`ft-row-${at()}`}
                        role="treeitem"
                        aria-level={row.level + 1}
                        aria-expanded={folder ? row.isExpanded : undefined}
                        aria-selected={selected() === row.path}
                        data-path={row.path}
                        data-focused={focused() === row.path ? "true" : undefined}
                        data-selected={selected() === row.path ? "true" : undefined}
                        data-enter={entering().has(row.path) ? "" : undefined}
                        data-drop={dropTarget() === plain(row.path) ? "" : undefined}
                        class="ft-row"
                        style={{ "padding-left": `${INDENT + row.level * GUIDE_GAP}px` }}
                        draggable={true}
                        onClick={(event) => onRowClick(row, event)}
                        onDragStart={(event) => onRowDragStart(row, event)}
                        onDragEnd={() => {
                          setDragging(null)
                          setDropTarget(null)
                        }}
                        onDragOver={(event) => onRowDragOver(row, event)}
                        onDrop={(event) => onRowDrop(row, event)}
                        onContextMenu={() => setMenuPath(row.path)}
                      >
                        <For each={row.ancestorPaths}>
                          {(ancestor, level) => (
                            <span
                              class="ft-guide"
                              data-bright={plain(ancestor) === brightGuide() ? "" : undefined}
                              style={{ left: `${guideLeft(level())}px` }}
                            />
                          )}
                        </For>
                        <span class="ft-chev" data-open={folder && row.isExpanded ? "" : undefined}>
                          <Show when={folder}>
                            <RemixIcon icon={ChevronRightIcon} size={12} />
                          </Show>
                        </span>
                        <span class="ft-icon" style={{ color: folder ? undefined : tintOf(row.path) }}>
                          <Show when={folder} fallback={<TypeIcon type={fileType(fileOf(row.path))} size={16} />}>
                            <RemixIcon
                              icon={row.isExpanded ? FolderOpenIcon : FolderIcon}
                              size={16}
                              class="text-[var(--text-300)]"
                            />
                          </Show>
                        </span>
                        <Show
                          when={editing()?.path === row.path}
                          fallback={<span class="ft-name type-row">{folder ? row.name : fileName(row.path)}</span>}
                        >
                          <input
                            class="ft-input type-row"
                            aria-label="File name"
                            value={draft()}
                            spellcheck={false}
                            autocomplete="off"
                            onInput={(event) => setDraft(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault()
                                commitRename()
                              } else if (event.key === "Escape") {
                                event.preventDefault()
                                cancelRename()
                              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                event.preventDefault()
                              }
                            }}
                            onBlur={() => commitRename()}
                            onFocus={(event) => {
                              if (selectedOnce) return
                              selectedOnce = true
                              event.currentTarget.select()
                            }}
                            ref={(input) => {
                              renameInput = input
                              queueMicrotask(() => focusRename(0))
                            }}
                          />
                        </Show>
                        <Show when={freshAt(row)} keyed>
                          {(at) => (
                            <span
                              class="ft-dot"
                              data-on={opened().has(row.path) ? undefined : ""}
                              title={editedText(at)}
                            />
                          )}
                        </Show>
                      </div>
                    )
                  }}
                </For>
                <div
                  style={{
                    height: `${Math.max(0, (rows().length - windowRows().start - windowRows().rows.length) * rowHeight)}px`,
                  }}
                />
              </div>
              <Show when={!rows().length && query().trim()}>
                <p class="kt-none type-hint">No file matches “{query().trim()}”.</p>
              </Show>
            </div>
          </MenuV2.Context.Trigger>
          <MenuV2.Context.Portal>
            <MenuV2.Context.Content
              class="min-w-48"
              data-component="file-tree-menu"
              onCloseAutoFocus={(event: Event) => event.preventDefault()}
            >
              <Show
                when={menuTarget()}
                keyed
                fallback={
                  <>
                    <MenuV2.Item onSelect={() => startNew("file")}>New file</MenuV2.Item>
                    <MenuV2.Item onSelect={() => startNew("folder")}>New folder</MenuV2.Item>
                  </>
                }
              >
                {(target) => (
                  <>
                    <Show when={target.kind === "file"}>
                      <MenuV2.Item onSelect={() => openPath(target.path)}>Open</MenuV2.Item>
                      <MenuV2.Item onSelect={() => revealInFiles(target.path)}>Reveal in Files</MenuV2.Item>
                    </Show>
                    <Show when={target.kind === "directory"}>
                      <MenuV2.Item onSelect={() => startNew("file", plain(target.path))}>New file</MenuV2.Item>
                      <MenuV2.Item onSelect={() => startNew("folder", plain(target.path))}>New folder</MenuV2.Item>
                    </Show>
                    <MenuV2.Separator />
                    <MenuV2.Item onSelect={() => copyPath(target.path)}>Copy path</MenuV2.Item>
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
      </Show>
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
      <Pictogram name="files" size={44} />
      <p class="type-hint">No files yet. What the agents make shows up here.</p>
    </div>
  )
}
