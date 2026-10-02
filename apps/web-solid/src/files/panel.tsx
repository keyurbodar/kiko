import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, For } from "solid-js"
import { useApp } from "../lib/store"
import { createFile, withMade } from "./api"
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
	// The URL names the room. With none, use the open chat, else the first chat, so the tree is never an empty picker.
	const roomId = createMemo(
		() => /^\/files\/([^/]+)/.exec(location.pathname)?.[1] ?? useApp.activeThreadId() ?? chats()[0]?.id ?? "",
	)
	// Opening the section on a room loads that room's index.
	createEffect(() => {
		const id = roomId()
		if (id && id !== useApp.activeThreadId()) useApp.selectThread(id)
	})
	const files = createMemo(() => withMade(roomId(), useApp.activeFiles()))

	return (
		<div class="files-panel" data-component="files-panel">
			<select class="fp-picker" aria-label="chat" value={roomId()} onChange={(e) => navigate(filesHref(e.currentTarget.value))}>
				<For each={chats()}>{(c) => <option value={c.id} selected={c.id === roomId()}>{c.name || "new chat"}</option>}</For>
			</select>
			<div class="fp-tree">
				<FileTree
					roomId={roomId()}
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
