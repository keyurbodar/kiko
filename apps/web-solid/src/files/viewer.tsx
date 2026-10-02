import type { FileRef } from "@kiko/protocol"
import { createMemo, lazy, Match, Show, Switch } from "solid-js"
import { createMediaViewer } from "../chat/media/mediaViewer"
import { urls } from "../lib/store"
import type { MediaItem } from "../lib/types"
import { isImage, isTextFile, isVideo, MAX_EDIT_BYTES } from "./api"
import "./editor.css"

// The CodeMirror chunk loads when a text file opens and not before.
const TextEditor = lazy(() => import("./editor").then((m) => ({ default: m.TextEditor })))

/*
 * What the files route shows for one path. The room's index decides which file the path names
 * right now. Text opens in the editor, pictures and video go to the media viewer, and any other
 * file is a download. The path is not drawn here: the top bar shows it.
 */
export function FileViewer(props: { roomId: string; path: string; files: readonly FileRef[] }) {
	const file = createMemo(() => props.files.find((f) => f.name === props.path))
	// The editor keeps the version it opened. Later versions reach it as `file`.
	const opened = createMemo<FileRef | undefined>((prev) => (file() ? (prev ?? file()) : undefined), undefined)
	const media = createMediaViewer()
	const src = (f: FileRef) => urls.file(props.roomId, f.id)
	const item = (f: FileRef): MediaItem => ({
		kind: isVideo(f) ? "video" : "photo",
		src: src(f),
		width: f.width ?? 1600,
		height: f.height ?? 900,
		alt: f.name,
	})

	return (
		<div class="file-view" data-component="file-viewer">
			<Show when={file()} fallback={<div class="fv-center">no file here</div>}>
				{(ref) => (
					<Switch>
						<Match when={isImage(ref()) || isVideo(ref())}>
							<div class="fv-center" data-kind="media">
								<Show
									when={isVideo(ref())}
									fallback={
										<button type="button" class="fv-media" aria-label={`open ${ref().name}`} onClick={() => media.open([item(ref())], 0)}>
											<img src={src(ref())} alt={ref().name} class="fv-media" />
										</button>
									}
								>
									<video src={src(ref())} class="fv-media" controls preload="metadata" />
								</Show>
							</div>
						</Match>
						<Match when={isTextFile(ref()) && ref().size <= MAX_EDIT_BYTES}>
							<Show when={opened()} keyed>
								{(initial) => <TextEditor roomId={props.roomId} path={props.path} file={file()} initial={initial} />}
							</Show>
						</Match>
						<Match when={true}>
							<div class="fv-center" data-kind="download">
								<span>{ref().size > MAX_EDIT_BYTES && isTextFile(ref()) ? "too large to edit" : "no preview for this file"}</span>
								<a class="fv-link" href={src(ref())} download={ref().name.slice(ref().name.lastIndexOf("/") + 1)}>
									download
								</a>
							</div>
						</Match>
					</Switch>
				)}
			</Show>
			{media.view}
		</div>
	)
}
