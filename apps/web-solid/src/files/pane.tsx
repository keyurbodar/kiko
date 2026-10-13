import type { FileOp } from "@kiko/protocol"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { BackIcon, CheckIcon, CodeIcon, CopyIcon, DownloadIcon, EyeIcon, FileAddIcon, FolderAddIcon, TableIcon, WrapTextIcon } from "@kiko/ui/icons"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { closeFile, dropOpenFile, fileReveal, moveOpenFile, openFile, openFilePath } from "../chat/info/state"
import { urls, useApp } from "../lib/store"
import { createFile, PREVIEW_BYTES, readText, withMade } from "./api"
import { FileBreadcrumbs } from "./breadcrumbs"
import { SUBHEADER, SurfaceAction } from "./chrome"
import type { EditorState } from "./editor"
import { RENDERED, TEXT_KINDS, viewerKind, type ViewerKind } from "./kind"
import { buildIndex } from "./model"
import { FileTree } from "./tree"
import { FileViewer } from "./viewer"

/*
 * The files section of the chat's right panel, after t3code's file preview. One file is open at a
 * time. It shows under a header of a back arrow, crumbs and actions, and the back arrow returns to
 * the room's tree. With no file open the tree is the whole section.
 *
 * The shell loads this module with the panel's files section, never with the chat route.
 */

/** A saved switch. Storage can throw in a private window; the switch then lasts the session. */
function stored(key: string, fallback: boolean) {
	let initial = fallback
	try {
		const raw = localStorage.getItem(key)
		if (raw !== null) initial = raw === "1"
	} catch {}
	const [get, set] = createSignal(initial)
	const save = (value: boolean) => {
		set(value)
		try {
			localStorage.setItem(key, value ? "1" : "0")
		} catch {}
	}
	return [get, save] as const
}

// Reading rendered or as source is a preference, not a property of one file, as in t3code.
const PREFS = {
	markdown: stored("kiko:file-render-markdown", false),
	table: stored("kiko:file-render-table", true),
	html: stored("kiko:file-render-html", true),
}
const [wrap, setWrap] = stored("kiko:file-word-wrap", false)

const RENDERED_LABELS = {
	markdown: ["Show rendered markdown", "Show markdown source"],
	table: ["Show table", "Show source"],
	html: ["Show rendered page", "Show HTML source"],
} as const

const [newFile, setNewFile] = createSignal(0)
const [newFolder, setNewFolder] = createSignal(0)
/** A file made from the header opens as source, because there is nothing to render yet. */
const [sourceFor, setSourceFor] = createSignal<string | null>(null)

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

/*
 * The tree shows the user's drive as a top folder, home/, beside the chat's own files. A path
 * under it belongs to the drive: its bytes are served from /api/files/home, and its changes go to
 * the user socket. Moving between the two is refused, as for agents: it is a copy.
 */
const HOME = "home"
const inHome = (p: string) => p === HOME || p.startsWith(`${HOME}/`)
const strip = (p: string) => (p === HOME ? "" : p.slice(HOME.length + 1))
/** Where a tree path lives: its space (a room id or `home`) and its path there. */
const where = (chatId: string, p: string) => (inHome(p) ? { space: HOME, path: strip(p) } : { space: chatId, path: p })

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
	const [editor, setEditor] = createSignal<EditorState>("clean")
	createEffect(on(path, () => setEditor("clean")))
	const unsaved = () => editor() === "dirty" || editor() === "saving" || editor() === "error"

	// A line asked for shows in the source, so it wins over the rendered preference until the reader toggles.
	const reveal = () => {
		const p = path()
		return p ? fileReveal(props.chatId, p) : null
	}
	const [seenReveal, setSeenReveal] = createSignal<number | null>(null)
	const renderedMode = () => (file() ? RENDERED[kind()] : undefined)
	const rendered = () => {
		const mode = renderedMode()
		const r = reveal()
		return !!mode && sourceFor() !== path() && (!r || seenReveal() === r.n) && PREFS[mode][0]()
	}
	const toggleRendered = (mode: keyof typeof PREFS) => {
		PREFS[mode][1](!rendered())
		setSourceFor(null)
		const r = reveal()
		if (r) setSeenReveal(r.n)
	}

	const [copied, setCopied] = createSignal(false)
	let copiedTimer: ReturnType<typeof setTimeout> | undefined
	onCleanup(() => clearTimeout(copiedTimer))
	/** Copies the file's text. The clipboard gets a promise, so Safari keeps the click's permission across the fetch. */
	const copy = () => {
		const f = file()
		const p = path()
		if (!f || !p) return
		const text = readText(where(props.chatId, p).space, f.id, PREVIEW_BYTES).then((r) => {
			if (r.kind !== "text") throw new Error(r.kind)
			return r.text
		})
		const write =
			typeof ClipboardItem !== "undefined" && navigator.clipboard?.write
				? navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })])
				: text.then((t) => navigator.clipboard.writeText(t))
		write.then(
			() => {
				setCopied(true)
				clearTimeout(copiedTimer)
				copiedTimer = setTimeout(() => setCopied(false), 1500)
			},
			() => showToastV2({ title: "Could not copy this file", variant: "error" }),
		)
	}

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
						<FileBreadcrumbs path={p} index={index()} unsaved={unsaved()} onOpen={(to) => openFile(props.chatId, to)} />
						<Show when={!inHome(p) && file() ? extensionAt(p) : null}>
							{(name) => (
								<button
									type="button"
									class="h-6 shrink-0 rounded-md bg-[var(--accent-fill)] px-2 text-xs text-[var(--on-accent)] disabled:opacity-50"
									data-action="install-extension-file"
									disabled={proposing() || unsaved()}
									title="Review and install this extension"
									onClick={() => void installExtension(name())}
								>
									{proposing() ? "Checking" : "Install"}
								</button>
							)}
						</Show>
						<Show when={renderedMode()}>
							{(mode) => (
								<SurfaceAction
									label={RENDERED_LABELS[mode()][rendered() ? 1 : 0]}
									icon={rendered() ? CodeIcon : mode() === "table" ? TableIcon : EyeIcon}
									action="toggle-rendered"
									pressed={rendered()}
									onPress={() => toggleRendered(mode())}
								/>
							)}
						</Show>
						<Show when={file() && TEXT_KINDS.has(kind()) && !rendered()}>
							<SurfaceAction label={wrap() ? "Disable word wrap" : "Enable word wrap"} icon={WrapTextIcon} action="toggle-wrap" pressed={wrap()} onPress={() => setWrap(!wrap())} />
						</Show>
						<Show when={file() && TEXT_KINDS.has(kind())}>
							<SurfaceAction label={copied() ? "Copied" : "Copy contents"} icon={copied() ? CheckIcon : CopyIcon} action="copy-file" onPress={copy} />
						</Show>
						<Show when={file()}>
							{(f) => <SurfaceAction label="Save file" icon={DownloadIcon} action="download-file" href={urls.file(where(props.chatId, p).space, f().id)} download={baseName(p)} />}
						</Show>
					</div>
				)}
			</Show>
			<div class="flex min-h-0 flex-1 overflow-hidden">
				<Show when={path()} keyed>
					{(p) => (
						<section class="flex min-w-0 flex-1 flex-col" aria-label={baseName(p)} data-component="file-surface">
							<FileViewer
								roomId={where(props.chatId, p).space}
								path={where(props.chatId, p).path}
								file={file() && { ...file()!, name: where(props.chatId, p).path }}
								kind={kind()}
								rendered={rendered()}
								wrap={wrap()}
								reveal={reveal()}
								onEditorState={setEditor}
							/>
						</section>
					)}
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
