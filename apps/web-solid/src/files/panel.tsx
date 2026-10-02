import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { createFile, withMade } from "./api"
import { newFileRequests, newFolderRequests, requestNewFolder } from "../sidebar/new-file"
import { FileTree } from "./tree"
import "./panel.css"

/*
 * The sidebar column for the files section: a chat picker, then that room's file tree.
 * The URL names the room (`/files/<room>/<path>`). Rename and delete are not wired: the
 * server has no file rename or delete yet, so the tree gets no callback for them.
 */
export const filesHref = (roomId: string, path?: string) =>
	`/files/${roomId}${path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : ""}`

export default function FilesPanel() {
	const navigate = useNavigate()
	const location = useLocation()
	const chats = createMemo(() => useApp.bots())
	const roomId = createMemo(() => /^\/files\/([^/]+)/.exec(location.pathname)?.[1] || useApp.activeThreadId() || chats()[0]?.id || "")
	// Opening the section on a room loads that room's index.
	createEffect(() => {
		const id = roomId()
		if (id && id !== useApp.activeThreadId()) useApp.selectThread(id)
	})
	const files = createMemo(() => withMade(roomId(), useApp.activeFiles()))

	return (
		<div class="files-panel" data-component="files-panel">
			<div class="fp-top">
				<ChatSwitcher chats={chats()} roomId={roomId()} onPick={(id) => navigate(filesHref(id))} />
				<button type="button" class="fp-icon-btn" aria-label="new folder" title="new folder" onClick={requestNewFolder}>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13zM8 7.5v4M6 9.5h4" />
					</svg>
				</button>
			</div>
			<div class="fp-tree">
				<FileTree
					roomId={roomId()}
					newFileRequests={newFileRequests}
					newFolderRequests={newFolderRequests}
					files={files()}
					onOpen={(path) => navigate(filesHref(roomId(), path))}
					onNewFile={(path) => {
						void createFile(roomId(), path).then((made) => {
							if (made) navigate(filesHref(roomId(), path))
						})
					}}
				/>
			</div>
		</div>
	)
}

/** Which chat's files the tree shows: the chat's avatar and name, opening a list of every chat. */
function ChatSwitcher(props: { chats: readonly { id: string; name: string }[]; roomId: string; onPick: (id: string) => void }) {
	const [open, setOpen] = createSignal(false)
	const current = () => props.chats.find((c) => c.id === props.roomId)
	let root: HTMLDivElement | undefined
	const away = (e: PointerEvent) => {
		if (root && !root.contains(e.target as Node)) setOpen(false)
	}
	document.addEventListener("pointerdown", away)
	onCleanup(() => document.removeEventListener("pointerdown", away))
	return (
		<div class="fp-switch" ref={root} data-component="files-chat-switcher">
			<button
				type="button"
				class="fp-switch-btn"
				aria-haspopup="listbox"
				aria-expanded={open()}
				aria-label="chat"
				onClick={() => setOpen(!open())}
				onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
			>
				<IdentityAvatar seed={props.roomId || "none"} size={24} />
				<span class="fp-switch-name">{current()?.name || "new chat"}</span>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M3 4.5L6 7.5l3-3" />
				</svg>
			</button>
			<Show when={open()}>
				<div class="fp-switch-list" role="listbox" aria-label="chats">
					<For each={props.chats}>
						{(c) => (
							<button
								type="button"
								role="option"
								class="fp-switch-option"
								aria-selected={c.id === props.roomId}
								onClick={() => {
									setOpen(false)
									props.onPick(c.id)
								}}
							>
								<IdentityAvatar seed={c.id} size={22} />
								<span class="fp-switch-name">{c.name || "new chat"}</span>
							</button>
						)}
					</For>
				</div>
			</Show>
		</div>
	)
}
