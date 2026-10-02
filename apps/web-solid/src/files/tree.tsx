import type { FileRef } from "@kiko/protocol"
import { FileIcon } from "@kiko/ui/file-icon"
import { createTree } from "@kiko/ui/v2/tree/create-tree"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import type { SolidTree } from "@kiko/ui/v2/tree/create-tree"
import { createComputed, createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js"
import { Virtualizer } from "virtua/solid"
import "@kiko/ui/file-icon.css"
import "./tree.css"
import {
	basename,
	buildIndex,
	dirname,
	isHidden,
	join,
	loadExpanded,
	pathsUnder,
	ROOT,
	saveExpanded,
	VIRTUALIZE_AFTER,
} from "./model"

/*
 * The file tree in the chat's right panel. It draws the room's file index as a tree, the way kat's
 * code panel does: 30 px rows, 16 px per level, a rotating chevron, no
 * animation. The index is the only source of files. A write by an agent lands
 * as a `file` event, the room store updates `files`, and the tree rebuilds.
 *
 * Nothing here writes a file. New, rename, and delete call back, so the route
 * decides what they mean. A new folder exists only here until a file is put in
 * it, because the index holds files and not folders.
 */

export type FileTreeProps = {
	roomId: string
	/** The room's file index. `name` is the full path. */
	files: readonly FileRef[]
	/** The open file, drawn as the selected row. When given, it is the only selected row. */
	active?: string | null
	/** A file was opened, by click or Enter. */
	onOpen?: (path: string) => void
	/** Bumps when something outside the tree asks for a new file. */
	newFileRequests?: () => number
	/** Bumped by a "new folder" button outside the tree. When given, the tree draws no header of its own. */
	newFolderRequests?: () => number
	/** A new, empty file was named. */
	onNewFile?: (path: string) => void
	/** A folder was renamed or a file moved. `paths` are the files it changes. */
	onRename?: (from: string, to: string, paths: string[]) => void
	/** A file or a folder was deleted. `paths` are the files it removes. */
	onDelete?: (path: string, paths: string[]) => void
}

type Draft = { kind: "file" | "folder"; parent: string } | { kind: "rename"; path: string }
/** The draft sentinel is one value, so `For` keeps every real row mounted. */
type ItemInstance<T> = ReturnType<SolidTree<T>["items"]>[number]
const DRAFT = "draft"
type Row = ItemInstance<string> | typeof DRAFT

const Chevron = () => (
	<svg class="ft-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
		<path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
)

const NewFolderIcon = () => (
	<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
		<path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h2.2l1.3 1.5H12A1.5 1.5 0 0 1 13.5 6v5.5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5v-7Z" stroke="currentColor" />
		<path d="M8 7v3M6.5 8.5h3" stroke="currentColor" stroke-linecap="round" />
	</svg>
)

const storage = () => {
	try {
		return globalThis.localStorage
	} catch {
		return undefined
	}
}

export function FileTree(props: FileTreeProps): JSX.Element {
	const [localFolders, setLocalFolders] = createSignal<string[]>([])
	const paths = createMemo(() => props.files.map((f) => f.name))
	const index = createMemo(() => buildIndex(paths(), localFolders()))
	const [draft, setDraft] = createSignal<Draft | null>(null)
	const [menuTarget, setMenuTarget] = createSignal<string | null>(null)
	const [tick, setTick] = createSignal(0)
	let scrollEl: HTMLElement | undefined

	const tree = createTree<string>({
		rootItemId: ROOT,
		getItem: (id) => id,
		getChildren: (id) => index().children.get(id) ?? [],
		getItemName: (item) => basename(item.getId()),
		isItemFolder: (item) => index().folders.has(item.getId()),
		initialExpanded: loadExpanded(props.roomId, storage()),
	})

	// The index changed: tell the core, then re-read the visible rows.
	createComputed(
		on(index, () => {
			tree.core.rebuildTree()
			setTick((n) => n + 1)
		}, { defer: true }),
	)

	// One expanded set per room.
	createEffect(on(() => props.roomId, (id) => saveExpanded(id, storage(), tree.expanded()), { defer: true }))
	createEffect(() => saveExpanded(props.roomId, storage(), tree.expanded()))

	const items = createMemo(() => {
		tick()
		tree.items()
		return [...tree.core.getItems()]
	})

	const rows = createMemo<Row[]>(() => {
		const d = draft()
		const list: Row[] = [...items()]
		if (!d || d.kind === "rename") return list
		const at = d.parent === ROOT ? -1 : list.findIndex((r) => r !== DRAFT && r.getId() === d.parent)
		list.splice(at + 1, 0, DRAFT)
		return list
	})

	const selectedPath = () => tree.selected()[0] ?? tree.focused() ?? null
	const isFolder = (path: string) => index().folders.has(path)
	const depthOf = (path: string) => (path === ROOT ? 0 : path.split("/").length)

	/** A new item goes in the selected folder, or beside the selected file. */
	const parentForNew = () => {
		const path = menuTarget() ?? selectedPath()
		if (!path) return ROOT
		return isFolder(path) ? path : dirname(path)
	}

	const startNew = (kind: "file" | "folder", parent = parentForNew()) => {
		if (parent !== ROOT) tree.core.getItemInstance(parent).expand()
		setDraft({ kind, parent })
	}

	const startRename = (path: string) => setDraft({ kind: "rename", path })

	const remove = (path: string) => {
		const under = pathsUnder(paths(), path)
		setLocalFolders((f) => f.filter((x) => x !== path && !x.startsWith(`${path}/`)))
		props.onDelete?.(path, under)
	}

	const commit = (value: string) => {
		const d = draft()
		setDraft(null)
		const name = value.trim().replace(/\/+$/, "")
		if (!d || !name || name.includes("/")) return
		if (d.kind === "rename") {
			const to = join(dirname(d.path), name)
			if (to === d.path) return
			const under = pathsUnder(paths(), d.path)
			setLocalFolders((f) => f.map((x) => (x === d.path || x.startsWith(`${d.path}/`) ? to + x.slice(d.path.length) : x)))
			props.onRename?.(d.path, to, under)
			return
		}
		const path = join(d.parent, name)
		if (d.kind === "folder") {
			setLocalFolders((f) => [...f, path])
			tree.core.rebuildTree()
			if (d.parent !== ROOT) tree.core.getItemInstance(d.parent).expand()
		} else {
			props.onNewFile?.(path)
		}
	}

	let seen = props.newFileRequests?.() ?? 0
	createEffect(() => {
		const n = props.newFileRequests?.() ?? 0
		if (n === seen) return
		seen = n
		startNew("file")
	})

	let seenFolder = props.newFolderRequests?.() ?? 0
	createEffect(() => {
		const n = props.newFolderRequests?.() ?? 0
		if (n === seenFolder) return
		seenFolder = n
		startNew("folder")
	})

	const container = () => {
		const p = tree.containerProps() as { ref: (el: HTMLElement | null) => void; onKeyDown?: (e: KeyboardEvent) => void }
		return {
			...p,
			ref: (el: HTMLElement | null) => {
				scrollEl = el ?? undefined
				p.ref(el)
			},
			// F2 and Delete belong to the tree while it has focus. The tree's own keys
			// (arrows, Home, End) come from the core.
			onKeyDown: (e: KeyboardEvent) => {
				if ((e.target as HTMLElement).tagName === "INPUT") return
				const focused = tree.focused()
				if (focused && e.key === "F2") {
					e.preventDefault()
					startRename(focused)
				} else if (focused && (e.key === "Delete" || e.key === "Backspace") && !e.metaKey) {
					e.preventDefault()
					remove(focused)
				} else if (focused && e.key === "Enter" && !isFolder(focused)) {
					props.onOpen?.(focused)
				} else p.onKeyDown?.(e)
			},
		}
	}

	const NameInput = (p: { initial: string; depth: number; folder: boolean; icon?: JSX.Element }) => (
		<div class="ft-row ft-row--edit" style={{ "--ft-depth": p.depth }}>
			<span class="ft-caret" />
			{p.icon ?? <FileIcon node={{ path: p.initial || "untitled", type: p.folder ? "directory" : "file" }} />}
			<input
				class="ft-input"
				value={p.initial}
				spellcheck={false}
				autocomplete="off"
				ref={(el) =>
					queueMicrotask(() => {
						el.focus()
						el.setSelectionRange(0, p.initial.includes(".") ? p.initial.lastIndexOf(".") : p.initial.length)
					})
				}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (e.key === "Enter") commit(e.currentTarget.value)
					else if (e.key === "Escape") setDraft(null)
				}}
				onBlur={(e) => (draft() ? commit(e.currentTarget.value) : undefined)}
			/>
		</div>
	)

	const renderRow = (row: Row): JSX.Element => {
		if (row === DRAFT) {
			const d = draft() as Extract<Draft, { parent: string }> | null
			if (!d) return null
			return <NameInput initial="" depth={depthOf(d.parent)} folder={d.kind === "folder"} />
		}
		const item = row
		const id = item.getId()
		const folder = () => isFolder(id)
		const open = () => tree.expanded().includes(id)
		const renaming = () => {
			const d = draft()
			return d?.kind === "rename" && d.path === id
		}
		return (
			<Show
				when={!renaming()}
				fallback={<NameInput initial={basename(id)} depth={item.getItemMeta().level} folder={folder()} />}
			>
				<div
					{...tree.itemProps(item)}
					class="ft-row"
					data-path={id}
					data-folder={folder() ? "" : undefined}
					data-open={open() ? "" : undefined}
					data-hidden={isHidden(id) ? "" : undefined}
					data-selected={(props.active !== undefined ? props.active === id : tree.selected().includes(id)) ? "" : undefined}
					data-focused={tree.focused() === id ? "" : undefined}
					style={{ "--ft-depth": item.getItemMeta().level }}
					onClick={(e: MouseEvent) => {
						const handler = (tree.itemProps(item) as { onClick?: (e: MouseEvent) => void }).onClick
						handler?.(e)
						if (folder()) {
							if (open()) item.collapse()
							else item.expand()
						} else props.onOpen?.(id)
					}}
					onDblClick={() => startRename(id)}
				>
					<span class="ft-caret">
						<Show when={folder()}>
							<Chevron />
						</Show>
					</span>
					<FileIcon node={{ path: id, type: folder() ? "directory" : "file" }} expanded={open()} />
					<span class="ft-name">{basename(id)}</span>
				</div>
			</Show>
		)
	}

	return (
		<div class="file-tree" data-component="filetree" data-room={props.roomId}>
			<Show when={!props.newFolderRequests}>
				<div class="ft-header">
					<span class="ft-actions">
						<button type="button" class="ft-btn" aria-label="new folder" title="new folder" onClick={() => startNew("folder")}>
							<NewFolderIcon />
						</button>
					</span>
				</div>
			</Show>
			<MenuV2.Context>
				<MenuV2.Context.Trigger
					as="div"
					class="ft-scroll"
					onContextMenu={(e: MouseEvent) => {
						const el = (e.target as HTMLElement).closest<HTMLElement>("[data-path]")
						setMenuTarget(el?.dataset.path ?? null)
					}}
				>
					<div {...container()} class="ft-list" aria-label="files">
						<Show
							when={rows().length <= VIRTUALIZE_AFTER}
							fallback={
								<Virtualizer data={rows()} scrollRef={scrollEl?.parentElement ?? undefined}>
									{(row) => renderRow(row)}
								</Virtualizer>
							}
						>
							<For each={rows()}>{renderRow}</For>
						</Show>
						<Show when={rows().length === 0}>
							<div class="ft-empty">no files yet. agents save what they make here, and + adds one.</div>
						</Show>
					</div>
				</MenuV2.Context.Trigger>
				<MenuV2.Context.Portal>
					<MenuV2.Context.Content>
						<Show when={menuTarget()}>
							{(path) => (
								<>
									<MenuV2.Item onSelect={() => startRename(path())}>rename</MenuV2.Item>
									<MenuV2.Item onSelect={() => remove(path())}>delete</MenuV2.Item>
									<MenuV2.Separator />
								</>
							)}
						</Show>
						<MenuV2.Item onSelect={() => startNew("file")}>new file</MenuV2.Item>
						<MenuV2.Item onSelect={() => startNew("folder")}>new folder</MenuV2.Item>
					</MenuV2.Context.Content>
				</MenuV2.Context.Portal>
			</MenuV2.Context>
		</div>
	)
}
