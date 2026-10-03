import { FileIcon } from "@kiko/ui/file-icon"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { closeFile, openFile, openFilePath } from "../chat/info/state"
import { urls, useApp } from "../lib/store"
import { createFile, withMade } from "./api"
import { isEditable, viewerKind, type ViewerKind } from "./kind"
import { FileTree } from "./tree"
import { FileViewer, type ViewMode } from "./viewer"
import "./pane.css"

/*
 * The files tab of the chat's right panel, after t3code's file browser: the room's tree, and the
 * open file beside it. While a file is open the panel is wide, the tree is a 240 px column, and
 * the viewer fills the rest. Below 560 px there is no room for both, so the viewer takes the
 * whole tab and its back arrow returns to the tree.
 *
 * The shell loads this module with the panel's files tab, never with the chat route.
 */

const [newFile, setNewFile] = createSignal(0)
const [newFolder, setNewFolder] = createSignal(0)
/** A file made from the header opens in edit mode, because there is nothing to read yet. */
const [editNext, setEditNext] = createSignal<string | null>(null)

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

/** The modes the header offers for each kind, with their labels. An empty list shows no switch. */
const MODES: Record<ViewerKind, readonly [ViewMode, string][]> = {
	markdown: [["view", "preview"], ["source", "source"], ["edit", "edit"]],
	csv: [["view", "table"], ["source", "source"], ["edit", "edit"]],
	json: [["view", "view"], ["edit", "edit"]],
	text: [["view", "view"], ["edit", "edit"]],
	image: [],
	pdf: [],
	audio: [],
	video: [],
	other: [],
}

/** New file and new folder, drawn in the panel header while the files tab is open. */
export function FilesActions() {
	return (
		<>
			<IconButton label="new file" action="new-file" onClick={() => setNewFile((n) => n + 1)}>
				<path d="M4 1.5h5l3 3v10H4zM9 1.5v3h3M8 8v4M6 10h4" />
			</IconButton>
			<IconButton label="new folder" action="new-folder" onClick={() => setNewFolder((n) => n + 1)}>
				<path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13zM8 7.5v4M6 9.5h4" />
			</IconButton>
		</>
	)
}

function IconButton(props: { label: string; action: string; pressed?: boolean; onClick: () => void; children: unknown }) {
	return (
		<button
			type="button"
			class="fp-icon"
			aria-label={props.label}
			title={props.label}
			data-action={props.action}
			aria-pressed={props.pressed}
			onClick={() => props.onClick()}
		>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				{props.children as never}
			</svg>
		</button>
	)
}

export default function FilesPane(props: { chatId: string }) {
	// Bound to the open room, so it follows a chat switch.
	createEffect(() => onCleanup(useApp.onFilesRefused((_, reason) => showToastV2({ title: reason, variant: "error" }))))
	const files = createMemo(() => withMade(props.chatId, useApp.activeFiles()))
	const path = () => openFilePath(props.chatId)
	const file = createMemo(() => files().find((f) => f.name === path()))
	const kind = createMemo<ViewerKind>(() => {
		const f = file()
		return f ? viewerKind(f) : "other"
	})
	const [mode, setMode] = createSignal<ViewMode>("view")
	// Each file opens in view mode, except a file just made here.
	createEffect(
		on(path, (p) => {
			setMode(p && p === editNext() ? "edit" : "view")
			if (p === editNext()) setEditNext(null)
		}),
	)
	// A mode the kind does not offer falls back to view.
	createEffect(() => {
		if (mode() !== "view" && !MODES[kind()].some(([m]) => m === mode())) setMode("view")
	})

	const make = (p: string) => {
		void createFile(props.chatId, p).then((made) => {
			if (!made) return
			setEditNext(p)
			openFile(props.chatId, p)
		})
	}

	return (
		<div class="files-pane" data-component="files-pane" data-open={path() ? "" : undefined}>
			<div class="fp-tree">
				<FileTree
					roomId={props.chatId}
					files={files()}
					folders={useApp.activeFolders()}
					onNewFolder={(path) => useApp.fileOp({ op: "mkdir", path })}
					active={path()}
					newFileRequests={newFile}
					newFolderRequests={newFolder}
					onOpen={(p) => openFile(props.chatId, p)}
					onNewFile={make}
					onRename={(from, to) => {
						useApp.fileOp({ op: "mv", from, to })
						// The open file follows its move.
						const open = path()
						if (open && (open === from || open.startsWith(`${from}/`))) openFile(props.chatId, to + open.slice(from.length))
					}}
					onDelete={(p, paths) => {
						const open = path()
						useApp.fileOp({ op: "rm", paths: [p], recursive: paths.length !== 1 || paths[0] !== p })
						if (open && (open === p || open.startsWith(`${p}/`))) closeFile(props.chatId)
					}}
				/>
			</div>
			<Show when={path()} keyed>
				{(p) => (
					<section class="fp-view" aria-label={baseName(p)}>
						<header class="fp-view-head" data-component="file-header">
							<button type="button" class="fp-icon fp-back" aria-label="back to files" title="back to files" data-action="back-to-files" onClick={() => closeFile(props.chatId)}>
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M10 3L5 8l5 5" />
								</svg>
							</button>
							<FileIcon node={{ path: p, type: "file" }} />
							<span class="fp-path" title={p} data-component="file-path">
								<Show when={p.includes("/")}>
									<span class="fp-dir">{p.slice(0, p.lastIndexOf("/") + 1)}</span>
								</Show>
								<span class="fp-name">{baseName(p)}</span>
							</span>
							<Show when={file() && MODES[kind()].length}>
								<div class="fp-modes" role="group" aria-label="view">
									<For each={MODES[kind()]}>
										{([m, label]) => (
											<button type="button" class="fp-mode" data-mode={m} aria-pressed={mode() === m} onClick={() => setMode(m)}>
												{label}
											</button>
										)}
									</For>
								</div>
							</Show>
							<Show when={file()}>
								{(f) => (
									<a class="fp-icon" href={urls.file(props.chatId, f().id)} download={baseName(p)} aria-label="download" title="download" data-action="download-file">
										<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" />
										</svg>
									</a>
								)}
							</Show>
							<button type="button" class="fp-icon" aria-label="close file" title="close file" data-action="close-file" onClick={() => closeFile(props.chatId)}>
								<svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
									<path d="M1 1l6 6M7 1L1 7" />
								</svg>
							</button>
						</header>
						<FileViewer roomId={props.chatId} path={p} file={file()} kind={kind()} mode={isEditable(kind()) ? mode() : "view"} />
					</section>
				)}
			</Show>
		</div>
	)
}
