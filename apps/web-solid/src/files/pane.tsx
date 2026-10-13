import type { FileOp } from "@kiko/protocol"
import { BackIcon, FileAddIcon, FolderAddIcon } from "@kiko/ui/icons"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, lazy, on, onCleanup, Show, Suspense } from "solid-js"
import { closeFile, dropOpenFile, moveOpenFile, openFile, openFilePath } from "../chat/info/state"
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
 * The files section of the chat's right panel, after t3code's file preview. One file is open at a
 * time. It shows under a header of a back arrow, crumbs and actions, and the back arrow returns to
 * the room's tree. With no file open the tree is the whole section. Opening it full size moves the
 * same file into a dialog, and the panel waits behind it.
 *
 * The shell loads this module with the panel's files section, never with the chat route.
 */

const [newFile, setNewFile] = createSignal(0)
const [newFolder, setNewFolder] = createSignal(0)

/** New file and new folder, drawn in the files section header while the tree shows. */
export function FilesActions() {
	return (
		<>
			<SurfaceAction label="New file" icon={FileAddIcon} action="new-file" onPress={() => setNewFile((n) => n + 1)} />
			<SurfaceAction label="New folder" icon={FolderAddIcon} action="new-folder" onPress={() => setNewFolder((n) => n + 1)} />
		</>
	)
}

export default function FilesPane(props: { chatId: string }) {
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
	const home = createMemo(() => withMade(HOME, useApp.homeFiles()).map((f) => ({ ...f, name: `${HOME}/${f.name}` })))
	const files = createMemo(() => [...withMade(props.chatId, useApp.activeFiles()), ...home()])
	const folders = createMemo(() => [...useApp.activeFolders(), HOME, ...useApp.homeFolders().map((f) => `${HOME}/${f}`)])
	const index = createMemo(() => buildIndex(files().map((f) => f.name), folders()))
	const path = () => openFilePath(props.chatId)
	const file = createMemo(() => files().find((f) => f.name === path()))
	const kind = createMemo<ViewerKind>(() => {
		const f = file()
		return f ? viewerKind(f) : "other"
	})
	const view = createFileView(props.chatId, path, file, kind)
	// A dialog left open with no file would wake on the next file, so closing the file closes it.
	createEffect(() => {
		if (!path()) setFullSize(false)
	})

	/** The extension name when the open file is /extensions/<name>/extension.json in the chat's files. */
	const extensionAt = (p: string) => /^extensions\/([a-z][a-z0-9-]{1,31})\/extension\.json$/.exec(p)?.[1] ?? null
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

	const make = (p: string) => {
		const at = where(props.chatId, p)
		void createFile(at.space, at.path).then((made) => {
			if (!made) return
			setSourceFor(p)
			openFile(props.chatId, p)
		})
	}

	return (
		<div class="flex min-h-0 flex-1 flex-col" data-component="files-pane" data-open={path() ? "" : undefined}>
			<Show when={path()} keyed>
				{(p) => (
					<div class={SUBHEADER} data-component="file-header">
						<SurfaceAction label="Back to files" icon={BackIcon} action="close-file" onPress={() => closeFile(props.chatId)} />
						<FileBreadcrumbs path={p} index={index()} unsaved={view.unsaved()} onOpen={(to) => openFile(props.chatId, to)} />
						<Show when={!inHome(p) && file() ? extensionAt(p) : null}>
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
							{(f) => <FileActions view={view} chatId={props.chatId} path={p} file={f} kind={kind()} onExpand={() => setFullSize(true)} />}
						</Show>
					</div>
				)}
			</Show>
			<div class="flex min-h-0 flex-1 overflow-hidden">
				<Show when={path()} keyed>
					{(p) => (
						<Show
							when={!fullSize()}
							fallback={<div class="flex min-w-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted" data-component="file-full-size-note">Open full size. Close it to return here.</div>}
						>
							<FileBody chatId={props.chatId} path={p} file={file()} kind={kind()} view={view} />
						</Show>
					)}
				</Show>
				<Show when={fullSize() && path()}>
					<Suspense>
						<FileDialog chatId={props.chatId} path={path()!} file={file()} kind={kind()} />
					</Suspense>
				</Show>
				{/* The tree stays mounted while a file shows, so it keeps its folders and scroll. */}
				<aside
					class={`min-h-0 min-w-0 flex-1 flex-col px-2 pt-1 pb-2 ${path() ? "hidden" : "flex"}`}
					aria-label="File explorer"
					data-component="file-explorer"
				>
					<FileTree
						roomId={props.chatId}
						files={files()}
						folders={folders()}
						onNewFolder={(p) => op({ op: "mkdir", path: p })}
						active={path()}
						newFileRequests={newFile}
						newFolderRequests={newFolder}
						onOpen={(p) => openFile(props.chatId, p)}
						onNewFile={make}
						onRename={(from, to) => {
							op({ op: "mv", from, to })
							moveOpenFile(props.chatId, from, to)
						}}
						onDelete={(p, paths) => {
							op({ op: "rm", paths: [p], recursive: paths.length !== 1 || paths[0] !== p })
							dropOpenFile(props.chatId, p)
						}}
					/>
				</aside>
			</div>
		</div>
	)
}
