import type { FileOp } from "@kiko/protocol"
import { FileAddIcon, FolderAddIcon } from "@kiko/ui/icons"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, lazy, onCleanup, Show, Suspense } from "solid-js"
import { dropFileSurfaces, moveFileSurfaces, openFile } from "../chat/side/surfaces"
import { useApp } from "../lib/store"
import { createFile, withMade } from "./api"
import { FileBreadcrumbs } from "./breadcrumbs"
import { SUBHEADER, SurfaceAction } from "./chrome"
import { viewerKind, type ViewerKind } from "./kind"
import { buildIndex, HOME, inHome, strip, where } from "./model"
import { fullSize, setFullSize } from "./prefs"
import { FileActions, FileBody } from "./surface"
import { FileTree } from "./tree"
import { createFileView, setSourceFor } from "./view"

const FileDialog = lazy(() => import("./FileDialog"))

/*
 * The files of a chat, after t3code's file tree and file preview. `FilesTree` is the room's tree and
 * `FileSurface` is one file. Each is its own tab or section, so a file never lives inside the tree.
 * Opening it full size moves the same file into a dialog.
 */

const [newFile, setNewFile] = createSignal(0)
const [newFolder, setNewFolder] = createSignal(0)

/** New file and new folder, drawn above the tree. */
export function FilesActions() {
	return (
		<>
			<SurfaceAction label="New file" icon={FileAddIcon} action="new-file" onPress={() => setNewFile((n) => n + 1)} />
			<SurfaceAction label="New folder" icon={FolderAddIcon} action="new-folder" onPress={() => setNewFolder((n) => n + 1)} />
		</>
	)
}

/** The files a chat can see: its own, then the home drive, with the folders and an index of both. */
function useChatFiles(chatId: string) {
	const home = createMemo(() => withMade(HOME, useApp.homeFiles()).map((f) => ({ ...f, name: `${HOME}/${f.name}` })))
	const files = createMemo(() => [...withMade(chatId, useApp.activeFiles()), ...home()])
	const folders = createMemo(() => [...useApp.activeFolders(), HOME, ...useApp.homeFolders().map((f) => `${HOME}/${f}`)])
	const index = createMemo(() => buildIndex(files().map((f) => f.name), folders()))
	return { files, folders, index }
}

export function FilesTree(props: { chatId: string }) {
	// Bound to the open room, so it follows a chat switch.
	createEffect(() => onCleanup(useApp.onFilesRefused((_, reason) => showToastV2({ title: reason, variant: "error" }))))
	createEffect(() => onCleanup(useApp.onHomeRefused((_, reason) => showToastV2({ title: reason, variant: "error" }))))
	/** One file op, sent to the space its paths live in. */
	const op = (o: FileOp) => {
		const paths = o.op === "rm" ? o.paths : o.op === "mv" ? [o.from, o.to] : [o.path]
		const home = paths.map(inHome)
		if (home.some((h) => h !== home[0])) return showToastV2({ title: "Moving between home and this chat is a copy. Download it, then add it here", variant: "error" })
		if (paths.includes(HOME)) return showToastV2({ title: "Home stays where it is", variant: "error" })
		if (!home[0]) return useApp.fileOp(o)
		useApp.homeOp(o.op === "rm" ? { ...o, paths: o.paths.map(strip) } : o.op === "mv" ? { ...o, from: strip(o.from), to: strip(o.to) } : { ...o, path: strip(o.path) })
	}
	const { files, folders } = useChatFiles(props.chatId)
	const make = (p: string) => {
		const at = where(props.chatId, p)
		void createFile(at.space, at.path).then((made) => {
			if (!made) return
			setSourceFor(p)
			openFile(props.chatId, p)
		})
	}

	return (
		<aside class="flex min-h-0 min-w-0 flex-1 flex-col px-2 pt-1 pb-2" aria-label="File explorer" data-component="file-explorer">
			<FileTree
				roomId={props.chatId}
				files={files()}
				folders={folders()}
				onNewFolder={(p) => op({ op: "mkdir", path: p })}
				newFileRequests={newFile}
				newFolderRequests={newFolder}
				onOpen={(p) => openFile(props.chatId, p)}
				onNewFile={make}
				onRename={(from, to) => {
					op({ op: "mv", from, to })
					moveFileSurfaces(props.chatId, from, to)
				}}
				onDelete={(p, paths) => {
					op({ op: "rm", paths: [p], recursive: paths.length !== 1 || paths[0] !== p })
					dropFileSurfaces(props.chatId, p)
				}}
			/>
		</aside>
	)
}

/** The extension name when the path is /extensions/<name>/extension.json in the chat's files. */
const extensionAt = (p: string) => /^extensions\/([a-z][a-z0-9-]{1,31})\/extension\.json$/.exec(p)?.[1] ?? null

/** One file: its crumbs and actions in a header, then its viewer. */
export function FileSurface(props: { chatId: string; path: string }) {
	const { files, index } = useChatFiles(props.chatId)
	const file = createMemo(() => files().find((f) => f.name === props.path))
	const kind = createMemo<ViewerKind>(() => {
		const f = file()
		return f ? viewerKind(f) : "other"
	})
	const view = createFileView(props.chatId, () => props.path, file, kind)
	// A full-size dialog belongs to this file, so it closes with the tab.
	onCleanup(() => setFullSize(false))

	const navigate = useNavigate()
	const [proposing, setProposing] = createSignal(false)
	/** Sends the open extension folder as a waiting install, then opens its review. */
	const installExtension = async (name: string) => {
		setProposing(true)
		// The bundler for an extension folder loads on the click, so the files tab stays as small as before.
		const { proposeFromFiles } = await import("./extension-install")
		const out = await proposeFromFiles(props.chatId, name, useApp.activeFiles())
		setProposing(false)
		if (!out.ok) return showToastV2({ title: `${out.error}${out.problems?.length ? `: ${out.problems.slice(0, 3).join("; ")}` : ""}`, variant: "error" })
		navigate("/settings/extensions")
	}

	return (
		<div class="flex min-h-0 min-w-0 flex-1 flex-col" data-component="files-pane">
			<div class={SUBHEADER} data-component="file-header">
				<FileBreadcrumbs path={props.path} index={index()} unsaved={view.unsaved()} onOpen={(to) => openFile(props.chatId, to)} />
				<Show when={!inHome(props.path) && file() ? extensionAt(props.path) : null}>
					{(name) => (
						<button
							type="button"
							class="h-6 shrink-0 rounded-md bg-[var(--accent-fill)] px-2 text-xs text-[var(--on-accent)] disabled:opacity-50"
							data-action="install-extension-file"
							disabled={proposing() || view.unsaved()}
							title="Review and install this extension"
							onClick={() => void installExtension(name())}
						>
							{proposing() ? "Checking" : "Install"}
						</button>
					)}
				</Show>
				<Show when={file()} keyed>
					{(f) => <FileActions view={view} chatId={props.chatId} path={props.path} file={f} kind={kind()} onExpand={() => setFullSize(true)} />}
				</Show>
			</div>
			<div class="flex min-h-0 flex-1 overflow-hidden">
				<Show
					when={!fullSize()}
					fallback={<div class="flex min-w-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted" data-component="file-full-size-note">Open full size. Close it to return here.</div>}
				>
					<FileBody chatId={props.chatId} path={props.path} file={file()} kind={kind()} view={view} />
				</Show>
				<Show when={fullSize()}>
					<Suspense>
						<FileDialog chatId={props.chatId} path={props.path} file={file()} kind={kind()} />
					</Suspense>
				</Show>
			</div>
		</div>
	)
}
