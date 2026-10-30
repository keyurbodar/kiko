import { fileName, type FileRef } from "@kiko/protocol"
import { createEffect, createMemo, createSignal, lazy, Match, on, Show, Suspense, Switch, type JSX } from "solid-js"
import { fileSrc } from "../state/room"
import { NoPreview, SurfaceFailure, SurfaceLoading } from "./chrome"
import type { EditorState } from "./editor"
import { TEXT_KINDS, type ViewerKind } from "./kind"
import { PREVIEW_BYTES } from "./api"
import { recipeSlugOf } from "../recipes/doc"
import "./editor.css"

const TextEditor = lazy(() => import("./editor").then((m) => ({ default: m.TextEditor })))
const MarkdownView = lazy(() => import("./viewers/markdown"))
const TableView = lazy(() => import("./viewers/table"))
const HtmlView = lazy(() => import("./viewers/html"))
const PdfView = lazy(() => import("./viewers/pdf"))
const ImageView = lazy(() => import("./viewers/image"))
const LargeTextView = lazy(() => import("./viewers/large-text").then((m) => ({ default: m.LargeTextViewer })))
const AudioView = lazy(() => import("./viewers/audio"))
const BinaryView = lazy(() => import("./viewers/binary"))
const OfficeView = lazy(() => import("./viewers/office"))
const NotebookView = lazy(() => import("./viewers/notebook"))
const MermaidView = lazy(() => import("./viewers/mermaid"))
const FontView = lazy(() => import("./viewers/font"))
const RecipeDocument = lazy(() => import("../recipes/document"))

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
  const opened = createMemo<FileRef | undefined>((prev) => (props.file ? (prev ?? props.file) : undefined), undefined)
  const src = (f: FileRef) => fileSrc(props.roomId, f.id)
  return (
    <div
      class="file-view flex min-h-0 min-w-0 flex-1 flex-col"
      data-component="file-viewer"
      data-kind={props.kind}
      data-rendered={props.rendered ? "" : undefined}
    >
      <Show when={props.file} fallback={<SurfaceFailure message="This file is no longer here." />}>
        {(ref) => (
          <Suspense fallback={<SurfaceLoading />}>
            <Switch fallback={<NoPreview name={fileName(ref().name)} href={src(ref())} />}>
              <Match when={props.kind === "markdown" && recipeSlugOf(props.path)}>
                <RecipeDocument
                  roomId={props.roomId}
                  path={props.path}
                  file={ref()}
                  fallback={<MarkdownView roomId={props.roomId} file={ref()} />}
                />
              </Match>
              <Match when={props.kind === "markdown" && props.rendered}>
                <MarkdownView roomId={props.roomId} file={ref()} />
              </Match>
              <Match when={props.kind === "csv" && props.rendered}>
                <TableView roomId={props.roomId} file={ref()} />
              </Match>
              <Match when={props.kind === "html" && props.rendered}>
                <HtmlView roomId={props.roomId} file={ref()} />
              </Match>
              <Match when={TEXT_KINDS.has(props.kind) && ref().size > PREVIEW_BYTES}>
                <LargeTextView name={fileName(ref().name)} src={src(ref())} size={ref().size} delimiter={null} />
              </Match>
              <Match when={TEXT_KINDS.has(props.kind)}>
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
              <Match when={props.kind === "image"}>
                <ImageView src={src(ref())} name={fileName(ref().name)} />
              </Match>
              <Match when={props.kind === "pdf"}>
                <PdfView src={src(ref())} title={fileName(ref().name)} />
              </Match>
              <Match when={props.kind === "video"}>
                <Media src={src(ref())} error="Unable to load video.">
                  {(url, fail) => (
                    <div class="flex min-h-0 flex-1 items-center justify-center bg-black" data-component="file-video">
                      <video
                        src={url}
                        controls
                        playsinline
                        class="max-h-full w-full bg-black object-contain"
                        onError={fail}
                      />
                    </div>
                  )}
                </Media>
              </Match>
              <Match when={props.kind === "audio"}>
                <AudioView src={src(ref())} name={fileName(ref().name)} />
              </Match>
              <Match when={props.kind === "mermaid"}>
                <MermaidView name={fileName(ref().name)} src={src(ref())} size={ref().size} />
              </Match>
              <Match when={props.kind === "notebook"}>
                <NotebookView name={fileName(ref().name)} src={src(ref())} size={ref().size} />
              </Match>
              <Match when={props.kind === "font"}>
                <FontView name={fileName(ref().name)} src={src(ref())} size={ref().size} />
              </Match>
              <Match when={props.kind === "docx" || props.kind === "xlsx" || props.kind === "pptx"}>
                <OfficeView
                  src={src(ref())}
                  name={fileName(ref().name)}
                  kind={props.kind as "docx" | "xlsx" | "pptx"}
                  size={ref().size}
                />
              </Match>
              <Match when={props.kind === "archive"}>
                <BinaryView src={src(ref())} name={fileName(ref().name)} kind="archive" size={ref().size} />
              </Match>
              <Match when={props.kind === "other"}>
                <BinaryView src={src(ref())} name={fileName(ref().name)} kind="hex" size={ref().size} />
              </Match>
            </Switch>
          </Suspense>
        )}
      </Show>
    </div>
  )
}

function Media(props: { src: string; error: string; children: (src: string, fail: () => void) => JSX.Element }) {
  const [failed, setFailed] = createSignal(false)
  createEffect(
    on(
      () => props.src,
      () => setFailed(false),
      { defer: true },
    ),
  )
  return (
    <Show when={!failed()} fallback={<SurfaceFailure message={props.error} onRetry={() => setFailed(false)} />}>
      {props.children(props.src, () => setFailed(true))}
    </Show>
  )
}
