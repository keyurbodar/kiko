import type { FileRef } from "@kiko/protocol"
import { createMemo, createSignal, lazy, Match, Show, Suspense, Switch } from "solid-js"
import { createMediaViewer } from "../chat/media/mediaViewer"
import { formatBytes } from "../chat/info/format"
import { urls } from "../lib/store"
import { prettyJson, type ViewerKind } from "./kind"
import "./editor.css"

/*
 * What the files tab shows for one path. `viewerKind` picks the viewer, and each heavy one is its
 * own chunk: CodeMirror loads when a text file opens, the markdown parser when a markdown file
 * does, and so on. Pictures draw at once and open the lightbox on click.
 *
 * `mode` comes from the header: "view" is the kind's own view, "source" is the read-only text,
 * and "edit" is the text with save.
 */
export type ViewMode = "view" | "source" | "edit"

const TextEditor = lazy(() => import("./editor").then((m) => ({ default: m.TextEditor })))
const MarkdownView = lazy(() => import("./viewers/markdown"))
const TableView = lazy(() => import("./viewers/table"))
const PdfView = lazy(() => import("./viewers/pdf"))
const AudioView = lazy(() => import("./viewers/media").then((m) => ({ default: m.AudioView })))
const VideoView = lazy(() => import("./viewers/media").then((m) => ({ default: m.VideoView })))

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

export function FileViewer(props: { roomId: string; path: string; file: FileRef | undefined; kind: ViewerKind; mode: ViewMode }) {
	// The editor keeps the version it opened. Later versions reach it as `file`.
	const opened = createMemo<FileRef | undefined>((prev) => (props.file ? (prev ?? props.file) : undefined), undefined)
	const media = createMediaViewer()
	const [broken, setBroken] = createSignal<string | null>(null)
	const src = (f: FileRef) => urls.file(props.roomId, f.id)
	const textMode = () => props.mode !== "view" || props.kind === "text" || props.kind === "json"

	return (
		<div class="file-view" data-component="file-viewer" data-kind={props.kind} data-mode={props.mode}>
			<Show when={props.file} fallback={<div class="fv-center">no file here</div>}>
				{(ref) => (
					<Suspense fallback={<div class="fv-center">loading...</div>}>
						<Switch>
							<Match when={broken() === ref().id}>
								<Download file={ref()} src={src(ref())} note="this file did not load" />
							</Match>
							<Match when={(props.kind === "text" || props.kind === "json" || props.kind === "markdown" || props.kind === "csv") && textMode()}>
								<Show when={opened()} keyed>
									{(initial) => (
										<TextEditor
											roomId={props.roomId}
											path={props.path}
											file={props.file}
											initial={initial}
											editing={props.mode === "edit"}
											pretty={props.kind === "json" ? prettyJson : undefined}
										/>
									)}
								</Show>
							</Match>
							<Match when={props.kind === "markdown"}>
								<MarkdownView roomId={props.roomId} file={ref()} />
							</Match>
							<Match when={props.kind === "csv"}>
								<TableView roomId={props.roomId} file={ref()} />
							</Match>
							<Match when={props.kind === "image"}>
								<div class="fv-center" data-kind="image">
									<button
										type="button"
										class="fv-image"
										aria-label={`open ${baseName(ref().name)}`}
										onClick={() =>
											media.open([{ kind: "photo", src: src(ref()), width: ref().width ?? 1600, height: ref().height ?? 900, alt: ref().name }], 0)
										}
									>
										<img src={src(ref())} alt={ref().name} onError={() => setBroken(ref().id)} />
									</button>
								</div>
							</Match>
							<Match when={props.kind === "pdf"}>
								<PdfView src={src(ref())} title={baseName(ref().name)} />
							</Match>
							<Match when={props.kind === "audio"}>
								<AudioView src={src(ref())} title={baseName(ref().name)} />
							</Match>
							<Match when={props.kind === "video"}>
								<VideoView src={src(ref())} title={baseName(ref().name)} />
							</Match>
							<Match when={true}>
								<Download file={ref()} src={src(ref())} />
							</Match>
						</Switch>
					</Suspense>
				)}
			</Show>
			{media.view}
		</div>
	)
}

/** Any file the app cannot draw: its name, type and size, and the bytes. */
function Download(props: { file: FileRef; src: string; note?: string }) {
	return (
		<div class="fv-center" data-kind="download">
			<div class="fv-card">
				<span class="fv-card-name">{baseName(props.file.name)}</span>
				<span class="fv-card-meta">
					{props.note ?? `${props.file.type || "unknown type"} · ${formatBytes(props.file.size)}`}
				</span>
				<a class="fv-download" href={props.src} download={baseName(props.file.name)} data-action="download">
					download
				</a>
			</div>
		</div>
	)
}
