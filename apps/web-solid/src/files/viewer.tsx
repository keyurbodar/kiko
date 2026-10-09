import type { FileRef } from "@yuki/protocol"
import { createEffect, createMemo, createSignal, lazy, Match, on, Show, Suspense, Switch, type JSX } from "solid-js"
import { urls } from "../lib/store"
import { NoPreview, SurfaceFailure, SurfaceLoading } from "./chrome"
import type { EditorState } from "./editor"
import { TEXT_KINDS, type ViewerKind } from "./kind"
import "./editor.css"

/*
 * The body of one file tab, after t3code's file preview. `viewerKind` picks the view, and each
 * heavy one is its own chunk: CodeMirror loads when a source view opens, the markdown parser when
 * markdown renders, and so on. Pictures, video and sound are the browser's own elements, drawn in
 * the panel.
 *
 * A text kind shows its source unless `rendered` asks for the markdown, table or page instead.
 */

const TextEditor = lazy(() => import("./editor").then((m) => ({ default: m.TextEditor })))
const MarkdownView = lazy(() => import("./viewers/markdown"))
const TableView = lazy(() => import("./viewers/table"))
const HtmlView = lazy(() => import("./viewers/html"))
const PdfView = lazy(() => import("./viewers/pdf"))

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

export function FileViewer(props: {
	roomId: string
	path: string
	file: FileRef | undefined
	kind: ViewerKind
	rendered: boolean
	wrap: boolean
	reveal: { line: number; n: number } | null
	onEditorState?: (state: EditorState) => void
}) {
	// The editor keeps the version it opened. Later versions reach it as `file`.
	const opened = createMemo<FileRef | undefined>((prev) => (props.file ? (prev ?? props.file) : undefined), undefined)
	const src = (f: FileRef) => urls.file(props.roomId, f.id)
	return (
		<div class="file-view flex min-h-0 min-w-0 flex-1 flex-col" data-component="file-viewer" data-kind={props.kind} data-rendered={props.rendered ? "" : undefined}>
			<Show when={props.file} fallback={<SurfaceFailure message="This file is no longer here." />}>
				{(ref) => (
					<Suspense fallback={<SurfaceLoading />}>
						<Switch fallback={<NoPreview name={baseName(ref().name)} href={src(ref())} />}>
							<Match when={TEXT_KINDS.has(props.kind) && !props.rendered}>
								<Show when={opened()} keyed>
									{(initial) => (
										<TextEditor
											roomId={props.roomId}
											path={props.path}
											file={props.file}
											initial={initial}
											wrap={props.wrap}
											reveal={props.reveal}
											onState={props.onEditorState}
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
							<Match when={props.kind === "html"}>
								<HtmlView roomId={props.roomId} file={ref()} />
							</Match>
							<Match when={props.kind === "image"}>
								<Media src={src(ref())} error="Unable to load image.">
									{(url, fail) => (
										<div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" data-component="file-image">
											<img src={url} alt={baseName(ref().name)} class="max-h-full max-w-full object-contain" onError={fail} />
										</div>
									)}
								</Media>
							</Match>
							<Match when={props.kind === "pdf"}>
								<PdfView src={src(ref())} title={baseName(ref().name)} />
							</Match>
							<Match when={props.kind === "video"}>
								<Media src={src(ref())} error="Unable to load video.">
									{(url, fail) => (
										<div class="flex min-h-0 flex-1 items-center justify-center bg-black" data-component="file-video">
											<video src={url} controls playsinline class="max-h-full w-full bg-black object-contain" onError={fail} />
										</div>
									)}
								</Media>
							</Match>
							<Match when={props.kind === "audio"}>
								<Media src={src(ref())} error="Unable to load audio.">
									{(url, fail) => (
										<div class="flex min-h-0 flex-1 items-center justify-center p-6" data-component="file-audio">
											<audio src={url} controls preload="metadata" class="w-full max-w-xl" onError={fail} />
										</div>
									)}
								</Media>
							</Match>
						</Switch>
					</Suspense>
				)}
			</Show>
		</div>
	)
}

/** A picture, video or sound that may fail to load. Try again draws it afresh, as does a new version. */
function Media(props: { src: string; error: string; children: (src: string, fail: () => void) => JSX.Element }) {
	const [failed, setFailed] = createSignal(false)
	createEffect(on(() => props.src, () => setFailed(false), { defer: true }))
	return (
		<Show when={!failed()} fallback={<SurfaceFailure message={props.error} onRetry={() => setFailed(false)} />}>
			{props.children(props.src, () => setFailed(true))}
		</Show>
	)
}
