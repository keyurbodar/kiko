import type { FileRef } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { FileTree as Pierre, type ContextMenuItem as FileTreeContextMenuItem, type ContextMenuOpenContext as FileTreeContextMenuOpenContext } from "@pierre/trees"
import { ChevronsDownUp, ChevronsUpDown, FilePlus, FolderPlus } from "lucide-solid"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { KIKO_FILE_ICONS } from "../lib/entry-icon-pierre"
import { setFileDrag } from "../lib/file-drag"
import "./tree.css"
import { dirname, HOME, join, loadExpanded, pathsUnder, ROOT, saveExpanded } from "./model"

export type FileTreeProps = {
	roomId: string
	files: readonly FileRef[]
	folders?: readonly string[]
	onNewFolder?: (path: string) => void
	active?: string | null
	onOpen?: (path: string) => void
	onNewFile?: (path: string) => void
	onRename?: (from: string, to: string, paths: string[]) => void
	onDelete?: (path: string, paths: string[]) => void
}

const asFolder = (path: string) => `${path.replace(/\/+$/, "")}/`
const plain = (path: string) => path.replace(/\/+$/, "")

const TREE_CSS = `
	:host {
		--trees-bg-override: transparent;
		--trees-fg-override: var(--foreground);
		--trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
		--trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
		--trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
		--trees-font-family-override: var(--font-sans);
		--trees-font-size-override: 0.75rem;
		--trees-fg-muted-override: var(--muted-foreground);
		--trees-selected-focused-border-color-override: transparent;
	}
	button[data-type='item'], button[data-type='item']::before { border-radius: var(--radius-md); }
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
	const pending = new Map<string, "file" | "folder">()
	const [query, setQuery] = createSignal("")

	const filePaths = createMemo(() => props.files.map((f) => f.name.replace(/^\/+/, "")))
	const folderPaths = createMemo(() => (props.folders ?? []).map((f) => plain(f.replace(/^\/+/, ""))).filter(Boolean))
	const wanted = createMemo(() => [...filePaths(), ...folderPaths().map(asFolder)])
	let held = new Set<string>()

	const selectedPath = () => tree?.getSelectedPaths().at(-1) ?? null

	const parentForNew = () => {
		const path = selectedPath()
		if (!path) return ROOT
		return path.endsWith("/") ? plain(path) : dirname(path)
	}

	const freshName = (parent: string, kind: "file" | "folder") => {
		const taken = new Set(wanted().map(plain))
		for (let n = 1; ; n++) {
			const name = kind === "folder" ? (n === 1 ? "new folder" : `new folder ${n}`) : n === 1 ? "untitled" : `untitled ${n}`
			if (!taken.has(join(parent, name))) return name
		}
	}

	const startNew = (kind: "file" | "folder") => {
		if (!tree) return
		const parent = parentForNew()
		if (parent !== ROOT) {
			const dir = tree.getItem(asFolder(parent))
			if (dir?.isDirectory() && "expand" in dir) dir.expand()
		}
		const path = join(parent, freshName(parent, kind))
		const id = kind === "folder" ? asFolder(path) : path
		pending.set(id, kind)
		tree.add(id)
		if (!tree.startRenaming(id, { removeIfCanceled: true })) pending.delete(id)
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
			add("New file", () => {
				tree?.getItem(item.path)?.select()
				startNew("file")
			})
			add("New folder", () => {
				tree?.getItem(item.path)?.select()
				startNew("folder")
			})
			if (!isHome) sep()
		}
		if (!isHome) {
			add("Rename", () => void tree?.startRenaming(item.path))
			add("Delete", () => remove(item.path))
		}
		return root
	}

	onMount(() => {
		const expanded = loadExpanded(props.roomId, storage()).map(asFolder)
		const instance = new Pierre({
			paths: wanted(),
			icons: KIKO_FILE_ICONS,
			density: "compact",
			flattenEmptyDirectories: true,
			initialExpansion: "closed",
			initialExpandedPaths: expanded,
			fileTreeSearchMode: "hide-non-matches",
			search: false,
			// Rows are only draggable if the tree's drag is on. It never moves a file: `dragFile` below takes every drag.
			dragAndDrop: { canDrag: () => false, canDrop: () => false },
			renaming: {
				canRename: (item) => plain(item.path) !== HOME,
				onError: (error) => showToastV2({ title: error, variant: "error" }),
				onRename: (event) => {
					const from = plain(event.sourcePath)
					const to = plain(event.destinationPath)
					const key = pending.has(event.sourcePath) ? event.sourcePath : asFolder(from)
					const kind = pending.get(key)
					if (kind) {
						pending.delete(key)
						if (kind === "folder") props.onNewFolder?.(to)
						else props.onNewFile?.(to)
						return
					}
					if (from === to) return
					props.onRename?.(from, to, pathsUnder(filePaths(), from))
				},
			},
			composition: { contextMenu: { triggerMode: "right-click", render: menu } },
			onSelectionChange: (selected) => {
				if (syncing) return
				const path = selected.at(-1)
				// A folder only opens and closes. It is not the open file, so it must not stay highlighted.
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
		// A file row drags to the composer under Kiko's own type. The listener runs first and keeps the drag from the tree's own
		// drag session, which would select the row (opening the file under the pointer) and refuses to start while a search is on.
		const dragFile = (event: DragEvent) => {
			event.stopPropagation()
			const row = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset.itemPath !== undefined)
			const path = row?.dataset.itemPath
			if (!path || path.endsWith("/") || !filePaths().includes(path) || !event.dataTransfer) return event.preventDefault()
			setFileDrag(event.dataTransfer, path)
		}
		host.addEventListener("dragstart", dragFile, true)

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
			stop()
			clearTimeout(timer)
			instance.unmount()
			tree = undefined
		})
	})

	const folderSet = () => {
		const out = new Set(folderPaths())
		for (const path of filePaths()) for (let dir = dirname(path); dir !== ROOT; dir = dirname(dir)) out.add(dir)
		return out
	}

	createEffect(
		on(wanted, (next) => {
			if (!tree) return
			const target = new Set(next)
			const ops: Parameters<Pierre["batch"]>[0][number][] = []
			for (const path of target) if (!held.has(path)) ops.push({ type: "add", path })
			for (const path of held) if (!target.has(path) && !pending.has(path)) ops.push({ type: "remove", path, recursive: true })
			held = target
			if (ops.length) tree.batch(ops)
		}),
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
		const q = query().trim()
		tree?.setSearch(q || null)
	})

	const [allOpen, setAllOpen] = createSignal(false)
	const toggleAll = () => {
		const open = !allOpen()
		for (const dir of folderSet()) {
			const item = tree?.getItem(asFolder(dir))
			if (item?.isDirectory() && "expand" in item) open ? item.expand() : item.collapse()
		}
		setAllOpen(open)
	}

	return (
		<div class="kt-root" data-component="file-tree">
			<div class="kt-bar">
				<label class="kt-field">
					<input
						type="search"
						aria-label="Search files"
						placeholder="Search files"
						spellcheck={false}
						autocomplete="off"
						value={query()}
						onInput={(e) => setQuery(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key !== "Escape" || !query()) return
							e.stopPropagation()
							setQuery("")
						}}
					/>
				</label>
				<TooltipV2 placement="bottom" openDelay={400} value="New file">
					<button type="button" class="kt-btn" aria-label="New file" data-action="new-file" onClick={() => startNew("file")}>
						<FilePlus size={15} strokeWidth={1.75} aria-hidden="true" />
					</button>
				</TooltipV2>
				<TooltipV2 placement="bottom" openDelay={400} value="New folder">
					<button type="button" class="kt-btn" aria-label="New folder" data-action="new-folder" onClick={() => startNew("folder")}>
						<FolderPlus size={15} strokeWidth={1.75} aria-hidden="true" />
					</button>
				</TooltipV2>
				<Show when={folderSet().size > 0}>
					<TooltipV2 placement="bottom" openDelay={400} value={allOpen() ? "Collapse all folders" : "Expand all folders"}>
						<button type="button" class="kt-btn" aria-label={allOpen() ? "Collapse all folders" : "Expand all folders"} onClick={toggleAll}>
							<Show when={allOpen()} fallback={<ChevronsUpDown size={15} strokeWidth={1.75} aria-hidden="true" />}>
								<ChevronsDownUp size={15} strokeWidth={1.75} aria-hidden="true" />
							</Show>
						</button>
					</TooltipV2>
				</Show>
			</div>
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
