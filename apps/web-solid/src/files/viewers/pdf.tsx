import { ChevronDownIcon, ChevronUpIcon, MinusIcon, PlusIcon, ScanIcon } from "@kiko/ui/icons"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { TextLayer } from "pdfjs-dist"
import { createEffect, createMemo, createSignal, For, on, onCleanup, type JSX } from "solid-js"
import { SurfaceAction, SurfaceFailure, SurfaceLoading } from "../chrome"
import { openPdfDocument } from "./pdf-document"
import {
  currentPdfPage,
  pdfPageOffsets,
  pdfPageScrollTop,
  pdfPageWidth,
  PDF_MAX_ZOOM,
  PDF_MIN_ZOOM,
  stepPdfZoom,
  visiblePdfPages,
} from "./pdf-layout"
import "./pdf.css"

const MAX_BYTES = 50 * 1024 * 1024
const MAX_PAGES = 2000

type RenderTask = ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>

function PdfPage(props: {
  document: PDFDocumentProxy
  index: number
  width: number
  onSize: (index: number, ratio: number) => void
  onError: (message: string) => void
}): JSX.Element {
  let canvas!: HTMLCanvasElement
  let layer!: HTMLDivElement
  createEffect(() => {
    const pdf = props.document
    const index = props.index
    const width = props.width
    let cancelled = false
    let paint: RenderTask | undefined
    let textLayer: TextLayer | undefined
    let loaded: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | undefined
    void (async () => {
      const page = await pdf.getPage(index + 1)
      loaded = page
      if (cancelled) return page.cleanup()
      const natural = page.getViewport({ scale: 1 })
      props.onSize(index, natural.height / natural.width)
      const viewport = page.getViewport({ scale: width / natural.width })
      const ratio = Math.min(
        2,
        window.devicePixelRatio || 1,
        Math.sqrt((8 * 1024 * 1024) / (viewport.width * viewport.height)),
      )
      canvas.width = Math.ceil(viewport.width * ratio)
      canvas.height = Math.ceil(viewport.height * ratio)
      paint = page.render({
        canvas,
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
        background: "white",
      })
      layer.replaceChildren()
      layer.style.setProperty("--total-scale-factor", String(viewport.scale))
      textLayer = new TextLayer({
        container: layer,
        viewport,
        textContentSource: page.streamTextContent(),
      })
      await Promise.all([paint.promise, textLayer.render()])
    })().catch((cause: unknown) => {
      if (!cancelled) props.onError(cause instanceof Error ? cause.message : "This PDF page could not render.")
    })
    onCleanup(() => {
      cancelled = true
      paint?.cancel()
      textLayer?.cancel()
      void Promise.allSettled([paint?.promise]).then(() => loaded?.cleanup())
    })
  })
  return (
    <>
      <canvas ref={canvas} aria-label={`Page ${props.index + 1}`} class="block h-full w-full" />
      <div ref={layer} data-pdf-text-layer />
    </>
  )
}

export default function PdfViewer(props: { src: string; title: string }): JSX.Element {
  const [doc, setDoc] = createSignal<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = createSignal(0)
  const [error, setError] = createSignal<string | null>(null)
  const [revision, setRevision] = createSignal(0)
  const [ratios, setRatios] = createSignal<number[]>([])
  const [zoom, setZoom] = createSignal<number | null>(null)
  const [pageWidth, setPageWidth] = createSignal(612)
  const [panel, setPanel] = createSignal({ width: 600, height: 800 })
  const [scrollTop, setScrollTop] = createSignal(0)
  let scroller!: HTMLDivElement

  createEffect(
    on(
      () => [props.src, revision()] as const,
      ([src]) => {
        const controller = new AbortController()
        let opened: PDFDocumentProxy | undefined
        setDoc(null)
        setError(null)
        setRatios([])
        setZoom(null)
        setScrollTop(0)
        void (async () => {
          const response = await fetch(src, { signal: controller.signal })
          if (!response.ok) throw new Error("The PDF could not be loaded.")
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (bytes.byteLength > MAX_BYTES) throw new Error("Preview limited to files under 50 MB.")
          opened = await openPdfDocument(bytes)
          if (controller.signal.aborted) return
          if (opened.numPages > MAX_PAGES) throw new Error("Preview limited to 2,000 pages.")
          const first = (await opened.getPage(1)).getViewport({ scale: 1 })
          setPageWidth(first.width)
          setPageCount(opened.numPages)
          setRatios(Array.from({ length: opened.numPages }, () => first.height / first.width))
          setDoc(opened)
        })().catch((cause: unknown) => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to open this PDF.")
        })
        onCleanup(() => {
          controller.abort()
          void opened?.destroy()
        })
      },
    ),
  )

  const resize = (node: HTMLDivElement) => {
    const watch = new ResizeObserver(([entry]) => {
      if (entry) setPanel({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    watch.observe(node)
    setPanel({ width: node.clientWidth, height: node.clientHeight })
    onCleanup(() => watch.disconnect())
  }

  const onSize = (index: number, ratio: number) =>
    setRatios((old) => (old[index] === ratio ? old : old.map((value, at) => (at === index ? ratio : value))))
  const width = createMemo(() => pdfPageWidth(panel().width, pageWidth(), zoom()).width)
  const scale = createMemo(() => pdfPageWidth(panel().width, pageWidth(), zoom()).scale)
  const offsets = createMemo(() => pdfPageOffsets(ratios(), width()))
  const current = createMemo(() => currentPdfPage(offsets(), ratios().length, scrollTop()))
  const visible = createMemo(() => visiblePdfPages(ratios(), offsets(), scrollTop(), panel().height))

  const showPage = (index: number) => scroller?.scrollTo({ top: pdfPageScrollTop(offsets(), index) })
  const changeZoom = (next: number | null) => {
    const page = current()
    const offset = scrollTop() - (offsets()[page]! - 16)
    const previous = width()
    setZoom(next)
    const nextWidth = width()
    if (scroller && nextWidth !== previous)
      scroller.scrollTop = Math.max(0, offsets()[page]! - 16 + (offset * nextWidth) / previous)
  }

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-component="file-pdf">
      <div class="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-[var(--border-100)] px-2 text-hint text-fg3">
        <span class="mr-auto px-1" aria-live="polite">
          {doc() ? `Page ${current() + 1} of ${pageCount()}` : "PDF"}
        </span>
        <SurfaceAction
          label="Previous page"
          icon={ChevronUpIcon}
          action="pdf-previous"
          disabled={!doc() || current() === 0}
          onPress={() => showPage(current() - 1)}
        />
        <SurfaceAction
          label="Next page"
          icon={ChevronDownIcon}
          action="pdf-next"
          disabled={!doc() || current() + 1 >= pageCount()}
          onPress={() => showPage(current() + 1)}
        />
        <SurfaceAction
          label="Zoom out"
          icon={MinusIcon}
          action="pdf-zoom-out"
          disabled={scale() <= PDF_MIN_ZOOM}
          onPress={() => changeZoom(stepPdfZoom(scale(), -1))}
        />
        <span class="min-w-14 text-center">{zoom() === null ? "Fit width" : `${Math.round(scale() * 100)}%`}</span>
        <SurfaceAction
          label="Zoom in"
          icon={PlusIcon}
          action="pdf-zoom-in"
          disabled={scale() >= PDF_MAX_ZOOM}
          onPress={() => changeZoom(stepPdfZoom(scale(), 1))}
        />
        <SurfaceAction
          label="Fit width"
          icon={ScanIcon}
          action="pdf-fit"
          pressed={zoom() === null}
          onPress={() => changeZoom(null)}
        />
      </div>
      <div
        ref={(node) => {
          scroller = node
          resize(node)
        }}
        role="region"
        aria-label={props.title}
        tabIndex={0}
        class="relative min-h-0 w-full min-w-0 flex-1 overflow-auto outline-none"
        style={{ background: "var(--bg-000)" }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {error() ? (
          <SurfaceFailure message={error() ?? ""} onRetry={() => setRevision((value) => value + 1)} />
        ) : !doc() ? (
          <SurfaceLoading />
        ) : (
          <div
            class="relative"
            style={{
              height: `max(${offsets().at(-1) ?? 0}px, calc(100% + ${(offsets().at(-2) ?? 16) - 16}px))`,
              "min-width": `${width() + 32}px`,
            }}
          >
            <For each={visible()}>
              {(page) => (
                <div
                  class="absolute bg-white"
                  style={{
                    top: `${offsets()[page.index]}px`,
                    left: `${Math.max(16, (panel().width - width()) / 2)}px`,
                    width: `${width()}px`,
                    height: `${width() * page.ratio}px`,
                    "--total-scale-factor": 1,
                  }}
                >
                  <PdfPage document={doc()!} index={page.index} width={width()} onSize={onSize} onError={setError} />
                </div>
              )}
            </For>
          </div>
        )}
      </div>
    </div>
  )
}
