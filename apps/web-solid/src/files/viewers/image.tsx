import { MaximizeIcon, MinusIcon, PlusIcon, ScanIcon } from "@kiko/ui/icons"
import { createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import { createImageDialog } from "../../chat/ui/image-dialog"
import { SurfaceAction } from "../chrome"
import { fitScale, stepZoom, type Box } from "./image-zoom"

export default function ImageViewer(props: { src: string; name: string; onError?: () => void }): JSX.Element {
  let viewport!: HTMLDivElement
  const lightbox = createImageDialog()
  const [natural, setNatural] = createSignal<Box>({ width: 0, height: 0 })
  const [panel, setPanel] = createSignal<Box>({ width: 0, height: 0 })
  const [zoom, setZoom] = createSignal<number | null>(null)

  const fit = () => fitScale(natural(), panel())
  const scale = () => zoom() ?? fit()
  const scaled = () => {
    const n = natural()
    return n.width ? { width: n.width * scale(), height: n.height * scale() } : { width: 0, height: 0 }
  }

  createEffect(
    on(
      () => props.src,
      () => {
        setZoom(null)
        setNatural({ width: 0, height: 0 })
      },
    ),
  )

  onMount(() => {
    const watch = new ResizeObserver(([entry]) => {
      if (entry) setPanel({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    watch.observe(viewport)
    setPanel({ width: viewport.clientWidth, height: viewport.clientHeight })
    onCleanup(() => watch.disconnect())
  })

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-component="file-image">
      <div class="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-[var(--stroke-tertiary)] px-3 text-xs text-tertiary">
        <span class="min-w-0 flex-1 truncate" role="status">
          {natural().width
            ? `${natural().width.toLocaleString()} × ${natural().height.toLocaleString()}`
            : "Loading image…"}
        </span>
        <SurfaceAction
          label="Zoom out"
          icon={MinusIcon}
          action="image-zoom-out"
          disabled={!natural().width || scale() <= 0.05}
          onPress={() => setZoom(stepZoom(scale(), -1))}
        />
        <span class="min-w-10 text-center" data-component="image-zoom-chip">
          {Math.round(scale() * 100)}%
        </span>
        <SurfaceAction
          label="Zoom in"
          icon={PlusIcon}
          action="image-zoom-in"
          disabled={!natural().width || scale() >= 8}
          onPress={() => setZoom(stepZoom(scale(), 1))}
        />
        <SurfaceAction
          label="Fit image"
          icon={ScanIcon}
          action="image-fit"
          pressed={zoom() === null}
          onPress={() => setZoom(null)}
        />
        <SurfaceAction
          label="Actual size"
          icon={MaximizeIcon}
          action="image-actual"
          pressed={zoom() === 1}
          onPress={() => setZoom(1)}
        />
      </div>
      <div ref={viewport} class="min-h-0 flex-1 overflow-auto overscroll-contain">
        <div
          class="flex min-h-full min-w-full items-center justify-center p-4"
          style={
            natural().width ? { width: `${scaled().width + 32}px`, height: `${scaled().height + 32}px` } : undefined
          }
        >
          <button
            type="button"
            aria-label={`Zoom ${props.name}`}
            class="shrink-0 cursor-zoom-in"
            data-action="image-expand"
            onClick={() => lightbox.open([{ src: props.src, name: props.name }], 0)}
          >
            <img
              src={props.src}
              alt={props.name}
              draggable={false}
              class="block max-w-none select-none"
              style={
                natural().width
                  ? { width: `${scaled().width}px`, height: `${scaled().height}px` }
                  : { "max-width": "100%" }
              }
              onLoad={(event) =>
                setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              }
              onError={() => props.onError?.()}
            />
          </button>
        </div>
      </div>
      {lightbox.view}
    </div>
  )
}
