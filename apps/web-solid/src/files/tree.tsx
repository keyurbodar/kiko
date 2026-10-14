import type { FileRef } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { FileTree as Pierre, type ContextMenuItem as FileTreeContextMenuItem, type ContextMenuOpenContext as FileTreeContextMenuOpenContext } from "@pierre/trees"
import { ChevronsDownUp, ChevronsUpDown, FilePlus, FolderPlus, Search } from "lucide-solid"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import "./tree.css"
import { dirname, HOME, join, loadExpanded, pathsUnder, ROOT, saveExpanded } from "./model"

/*
 * The file tree in the chat's side panel, drawn by `@pierre/trees`, the tree t3code uses. The room's
 * file index is the only source of files: a write by an agent lands as a `file` event, the room
 * store updates `files`, and the tree is told what was added or removed. Folders are the room's own,
 * empty ones included, and a folder's path ends with a slash for the tree.
 *
 * Nothing here writes a file. New, rename, and delete call back, so the route decides what they mean.
 */

export type FileTreeProps = {
	roomId: string
	/** The room's file index. `name` is the full path. */
	files: readonly FileRef[]
	/** The room's folders, empty ones included. */
	folders?: readonly string[]
	/** A new folder was named. */
	onNewFolder?: (path: string) => void
	/** The open file, drawn as the selected row. */
	active?: string | null
	/** A file was opened, by click or Enter. */
	onOpen?: (path: string) => void
	/** A new, empty file was named. */
	onNewFile?: (path: string) => void
	/** A folder was renamed or a file moved. `paths` are the files it changes. */
	onRename?: (from: string, to: string, paths: string[]) => void
	/** A file or a folder was deleted. `paths` are the files it removes. */
	onDelete?: (path: string, paths: string[]) => void
}

const asFolder = (path: string) => `${path.replace(/\/+$/, "")}/`
const plain = (path: string) => path.replace(/\/+$/, "")

/** Shadow-root styles that make the tree read as part of the panel. */
const TREE_CSS = `
	:host {
		--trees-bg-override: transparent;
		--trees-fg-override: var(--text);
		--trees-selected-bg-override: var(--selected-bg);
		--trees-hover-bg-override: var(--hover-bg);
		--trees-border-color-override: var(--hairline);
		--trees-font-family-override: inherit;
		--trees-font-size-override: var(--font-md);
		--trees-fg-muted-override: var(--text-muted);
		--trees-focus-ring-width-override: 1px;
		--trees-focus-ring-offset-override: -1px;
		--trees-focus-ring-color-override: color-mix(in oklab, var(--accent) 55%, transparent);
		--trees-selected-focused-border-color-override: transparent;
		--trees-padding-inline-override: 4px;
	}
	button[data-type='item'], button[data-type='item']::before { border-radius: var(--radius-md); }
`

export function FileTree(props: FileTreeProps): JSX.Element {
	let host!: HTMLDivElement
	let tree: Pierre | undefined
	let syncing = false
	/** Rows added for a name that has not been given yet, by the path they hold now. */
	const pending = new Map<string, "file" | "folder">()
	const [query, setQuery] = createSignal("")

	const filePaths = createMemo(() => props.files.map((f) => f.name.replace(/^\/+/, "")))
	const folderPaths = createMemo(() => (props.folders ?? []).map((f) => plain(f.replace(/^\/+/, ""))).filter(Boolean))
	/** The paths the tree should hold. A folder ends with a slash. */
	const wanted = createMemo(() => [...filePaths(), ...folderPaths().map(asFolder)])
	let held = new Set<string>()

	const selectedPath = () => tree?.getSelectedPaths().at(-1) ?? null

	/** A new item goes in the selected folder, or beside the selected file. */
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
			icons: { set: "complete", colored: true },
			density: "compact",
			flattenEmptyDirectories: true,
			initialExpansion: "closed",
			initialExpandedPaths: expanded,
			fileTreeSearchMode: "hide-non-matches",
			search: false,
			dragAndDrop: false,
			renaming: {
				canRename: (item) => plain(item.path) !== HOME,
				onError: (error) => showToastV2({ title: error, variant: "error" }),
				onRename: (event) => {
					const from = plain(event.sourcePath)
					const to = plain(event.destinationPath)
					const kind = pending.get(event.sourcePath)
					if (kind) {
						pending.delete(event.sourcePath)
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
				// A row waiting for its name is selected too, and is not a file yet.
				if (path && !path.endsWith("/") && !pending.has(path) && filePaths().includes(path)) props.onOpen?.(path)
			},
			unsafeCSS: TREE_CSS,
		})
		tree = instance
		held = new Set(wanted())
		instance.render({ containerWrapper: host })

		// The open directories are saved a moment after the tree settles, one set per room.
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
			stop()
			clearTimeout(timer)
			instance.unmount()
			tree = undefined
		})
	})

	/** Every folder the file paths imply, plus the room's own. */
	const folderSet = () => {
		const out = new Set(folderPaths())
		for (const path of filePaths()) for (let dir = dirname(path); dir !== ROOT; dir = dirname(dir)) out.add(dir)
		return out
	}

	// The index changed: add what is new and remove what is gone, so open folders stay open.
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
					<Search size={14} strokeWidth={1.75} aria-hidden="true" />
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
			<div class="kt-host" ref={host} aria-label="Files" />
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

