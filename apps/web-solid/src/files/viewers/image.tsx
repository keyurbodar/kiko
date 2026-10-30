import { MaximizeIcon, MinusIcon, PlusIcon, ScanIcon } from "@kiko/ui/icons"
import { createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import { anchorAt, scrollFor } from "../../chat/ui/zoom"
import { SurfaceAction } from "../chrome"
import { clickZoom, doubleClickZoom, fitScale, keyZoom, stepZoom, type Box } from "./image-zoom"

export default function ImageViewer(props: { src: string; name: string; onError?: () => void }): JSX.Element {
  let viewport!: HTMLDivElement
  const [natural, setNatural] = createSignal<Box>({ width: 0, height: 0 })
  const [panel, setPanel] = createSignal<Box>({ width: 0, height: 0 })
  const [zoom, setZoom] = createSignal<number | null>(null)
  const [dragging, setDragging] = createSignal(false)
  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null
  let dragListeners: { move: (event: PointerEvent) => void; end: (event: PointerEvent) => void } | null = null
  let dragged = false
  let clickTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    clearTimeout(clickTimer)
    endDrag()
  })

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

  const change = (next: number, point?: { clientX: number; clientY: number }) => {
    const previous = scale()
    if (!Number.isFinite(next) || Math.abs(next - previous) < 0.0001) return
    const bounds = viewport.getBoundingClientRect()
    const at = point
      ? { x: point.clientX - bounds.left, y: point.clientY - bounds.top }
      : { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }
    const anchor = anchorAt({ x: viewport.scrollLeft, y: viewport.scrollTop }, at, previous)
    setZoom(next)
    const moved = viewport.getBoundingClientRect()
    const scroll = scrollFor(anchor, { x: bounds.left + at.x - moved.left, y: bounds.top + at.y - moved.top }, next)
    viewport.scrollLeft = scroll.x
    viewport.scrollTop = scroll.y
  }

  function endDrag(event?: PointerEvent) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    if (dragListeners) {
      window.removeEventListener("pointermove", dragListeners.move)
      window.removeEventListener("pointerup", dragListeners.end)
      window.removeEventListener("pointercancel", dragListeners.end)
    }
    dragListeners = null
    drag = null
    setDragging(false)
  }

  function startDrag(event: PointerEvent) {
    if (drag || event.pointerType !== "mouse" || event.button !== 0 || scale() <= fit() * 1.001) return
    dragged = false
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    }
    const move = (moveEvent: PointerEvent) => {
      if (!drag || moveEvent.pointerId !== drag.pointerId) return
      if (Math.hypot(moveEvent.clientX - drag.x, moveEvent.clientY - drag.y) > 4) dragged = true
      viewport.scrollLeft = drag.left - (moveEvent.clientX - drag.x)
      viewport.scrollTop = drag.top - (moveEvent.clientY - drag.y)
    }
    const end = (endEvent: PointerEvent) => endDrag(endEvent)
    dragListeners = { move, end }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    setDragging(true)
  }

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-component="file-image">
      <div class="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-[var(--border-100)] px-3 text-hint text-fg3">
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
          onPress={() => change(stepZoom(scale(), -1))}
        />
        <span class="min-w-10 text-center" data-component="image-zoom-chip">
          {Math.round(scale() * 100)}%
        </span>
        <SurfaceAction
          label="Zoom in"
          icon={PlusIcon}
          action="image-zoom-in"
          disabled={!natural().width || scale() >= 8}
          onPress={() => change(stepZoom(scale(), 1))}
        />
        <SurfaceAction
          label="Fit image"
          icon={ScanIcon}
          action="image-fit"
          pressed={zoom() === null}
          onPress={() => change(fit())}
        />
        <SurfaceAction
          label="Actual size"
          icon={MaximizeIcon}
          action="image-actual"
          pressed={zoom() === 1}
          onPress={() => change(1)}
        />
      </div>
      <div
        ref={viewport}
        role="region"
        aria-label={`${props.name}, zoomable image`}
        tabIndex={0}
        class="min-h-0 flex-1 overflow-auto overscroll-contain outline-none"
        style={{
          cursor: scale() > fit() * 1.001 ? (dragging() ? "grabbing" : "grab") : "zoom-in",
        }}
        onWheel={(event) => {
          if (!event.deltaY || !natural().width) return
          event.preventDefault()
          const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1)
          change(scale() * Math.exp(-pixels * (event.ctrlKey ? 0.01 : 0.002)), event)
        }}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          const next = keyZoom(event.key, scale(), fit())
          if (next === null) return
          event.preventDefault()
          change(next)
        }}
        onPointerDown={startDrag}
        onClick={(event) => {
          if (dragged || event.detail > 1 || !natural().width) return
          clearTimeout(clickTimer)
          clickTimer = setTimeout(() => change(clickZoom(scale(), fit())), 220)
        }}
        onDblClick={() => {
          if (!natural().width) return
          clearTimeout(clickTimer)
          change(doubleClickZoom(scale(), fit()))
        }}
      >
        <div
          class="flex min-h-full min-w-full items-center justify-center p-4"
          style={
            natural().width ? { width: `${scaled().width + 32}px`, height: `${scaled().height + 32}px` } : undefined
          }
        >
          <img
            src={props.src}
            alt={props.name}
            draggable={false}
            class="block max-w-none select-none"
            style={
              natural().width
                ? { width: `${scaled().width}px`, height: `${scaled().height}px` }
                : { "max-width": "100%", "max-height": "100%" }
            }
            onLoad={(event) =>
              setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            }
            onError={() => props.onError?.()}
          />
        </div>
      </div>
    </div>
  )
}
