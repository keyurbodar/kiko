import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "@kiko/ui/icons"
import { Show, createSignal, createUniqueId, onCleanup, onMount } from "solid-js"
import { wrapIndex } from "../../lib/attachments"
import "./image-dialog.css"
import { FLIP_MS, flip, reducedMotion } from "./flip"
import type { DialogImage } from "./image-dialog"
import {
  anchorAt,
  clampZoom,
  clickZoom,
  fitScale,
  keyZoom,
  maxHeight,
  panStep,
  scrollFor,
  wheelZoom,
  type Point,
} from "./zoom"

const NAV =
  "absolute top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-row text-white/90 hover:bg-white/10 hover:text-white"

export default function ImageDialog(props: {
  images: readonly DialogImage[]
  index: number
  from?: Element | null
  onClose: () => void
}) {
  const [offset, setOffset] = createSignal(0)
  const [failed, setFailed] = createSignal<string | null>(null)
  const count = () => props.images.length
  const index = () => wrapIndex(props.index + offset(), count())
  const item = () => props.images[index()]
  const step = (by: -1 | 1) => setOffset((n) => n + by)
  let pan: ((key: string) => boolean) | undefined
  const [closing, setClosing] = createSignal(false)
  let shrink: ((to: DOMRect) => void) | undefined
  const thumbnail = () =>
    offset() === 0 && props.from?.isConnected ? (props.from.querySelector("img") ?? props.from) : null
  const close = () => {
    if (closing()) return
    const to = thumbnail()?.getBoundingClientRect()
    if (reducedMotion() || !to || !shrink) return props.onClose()
    setClosing(true)
    shrink(to)
    setTimeout(props.onClose, FLIP_MS)
  }

  return (
    <ModalV2 open onOpenChange={(open: boolean) => !open && close()}>
      <ModalV2.Portal>
        <ModalV2.Overlay class="bg-black/80!" data-closing={closing() ? "" : undefined} />
        <ModalV2.Content
          class="h-[92vh] w-[92vw] items-center justify-center"
          data-lightbox=""
          data-closing={closing() ? "" : undefined}
          onOpenAutoFocus={(event: Event) => {
            const picture = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              '[data-component="image-dialog-viewport"]',
            )
            if (!picture) return
            event.preventDefault()
            picture.focus()
          }}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return
            if (pan?.(event.key)) return event.preventDefault()
            if (count() < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
            event.preventDefault()
            step(event.key === "ArrowLeft" ? -1 : 1)
          }}
          onClick={(event: MouseEvent) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <ModalV2.Title class="sr-only">Image preview</ModalV2.Title>
          <button
            type="button"
            data-chrome=""
            class="absolute top-0 right-0 z-30 grid size-8 place-items-center rounded-row bg-black/65 text-white shadow-sm ring-1 ring-white/20 hover:bg-black/80"
            aria-label="Close image preview"
            onClick={close}
          >
            <RemixIcon icon={CloseIcon} class="size-4" />
          </button>
          <Show when={count() > 1}>
            <button
              type="button"
              data-chrome=""
              class={`${NAV} left-0`}
              aria-label="Previous image"
              onClick={() => step(-1)}
            >
              <RemixIcon icon={ChevronLeftIcon} class="size-5" />
            </button>
          </Show>
          <Show when={item()} keyed>
            {(image) => (
              <div
                class="relative z-10 flex max-w-[calc(92vw-96px)] flex-col items-center"
                data-component="image-dialog"
                data-swap={offset() === 0 ? undefined : ""}
              >
                <Show
                  when={failed() !== image.src}
                  fallback={
                    <div
                      role="alert"
                      class="flex h-48 w-[min(92vw,32rem)] items-center justify-center rounded-row border border-white/15 bg-black p-6 text-center text-label text-white"
                    >
                      Image unavailable. The file may have been moved or deleted.
                    </div>
                  }
                >
                  <ZoomableImage
                    src={image.src}
                    name={image.name}
                    from={offset() === 0 ? (props.from?.querySelector("img") ?? props.from ?? null) : null}
                    onError={() => setFailed(image.src)}
                    panRef={(fn) => (pan = fn)}
                    shrinkRef={(fn) => (shrink = fn)}
                  />
                </Show>
                <p
                  class="mt-2 max-w-full truncate text-hint text-white/80"
                  aria-live="polite"
                  data-chrome=""
                  data-component="image-dialog-caption"
                >
                  {image.name}
                  {count() > 1 ? ` (${index() + 1}/${count()})` : ""}
                </p>
              </div>
            )}
          </Show>
          <Show when={count() > 1}>
            <button
              type="button"
              data-chrome=""
              class={`${NAV} right-0`}
              aria-label="Next image"
              onClick={() => step(1)}
            >
              <RemixIcon icon={ChevronRightIcon} class="size-5" />
            </button>
          </Show>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}

function ZoomableImage(props: {
  src: string
  name: string
  from: Element | null
  onError: () => void
  panRef: (pan: (key: string) => boolean) => void
  shrinkRef: (shrink: (to: DOMRect) => void) => void
}) {
  let viewport!: HTMLDivElement
  const hint = createUniqueId()
  const [natural, setNatural] = createSignal({ width: 0, height: 0 })
  const [window_, setWindow] = createSignal({ width: window.innerWidth, height: window.innerHeight })
  const [zoom, setZoom] = createSignal(1)
  const [dragging, setDragging] = createSignal(false)
  const [waiting, setWaiting] = createSignal(props.from !== null && !reducedMotion())
  props.shrinkRef((to) => flip(viewport, to, "out"))
  const impatient = setTimeout(() => setWaiting(false), 250)
  onCleanup(() => clearTimeout(impatient))
  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null
  let dragged = false
  const fit = () => fitScale(natural(), window_())
  const width = () => natural().width * fit() * zoom()
  const height = () => natural().height * fit() * zoom()

  const change = (next: number, point?: Point) => {
    const previous = zoom()
    const target = clampZoom(next)
    if (target === previous) return
    const bounds = viewport.getBoundingClientRect()
    const at = point
      ? { x: point.x - bounds.left, y: point.y - bounds.top }
      : { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }
    const anchor = anchorAt({ x: viewport.scrollLeft, y: viewport.scrollTop }, at, previous)
    const screen = { x: bounds.left + at.x, y: bounds.top + at.y }
    setZoom(target)
    const moved = viewport.getBoundingClientRect()
    const scroll = scrollFor(anchor, { x: screen.x - moved.left, y: screen.y - moved.top }, target)
    viewport.scrollLeft = scroll.x
    viewport.scrollTop = scroll.y
  }

  props.panRef((key) => {
    const by = panStep(key)
    if (!by || zoom() <= 1) return false
    if (by.x && viewport.scrollWidth <= viewport.offsetWidth) return false
    viewport.scrollLeft += by.x
    viewport.scrollTop += by.y
    return true
  })

  onMount(() => {
    const resize = () => {
      setWindow({ width: window.innerWidth, height: window.innerHeight })
      change(1)
    }
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return
      event.preventDefault()
      change(wheelZoom(zoom(), event, viewport.clientHeight), { x: event.clientX, y: event.clientY })
    }
    window.addEventListener("resize", resize)
    viewport.addEventListener("wheel", wheel, { passive: false })
    onCleanup(() => {
      window.removeEventListener("resize", resize)
      viewport.removeEventListener("wheel", wheel)
    })
  })

  const endDrag = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
    drag = null
    setDragging(false)
  }

  return (
    <div class="min-w-0">
      <div
        ref={viewport}
        role="region"
        aria-label={`${props.name}, zoomable image`}
        aria-describedby={hint}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region takes focus so the keyboard can scroll it
        tabIndex={0}
        class="max-w-[calc(92vw-96px)] overflow-auto overscroll-contain rounded-row border border-white/15 shadow-2xl outline-none max-sm:max-w-[92vw]"
        style={{
          width: width() ? `${width()}px` : undefined,
          height: height() ? `${height()}px` : undefined,
          "max-height": `${maxHeight(window_())}px`,
          opacity: waiting() ? 0 : undefined,
          cursor: zoom() > 1 ? (dragging() ? "grabbing" : "grab") : "zoom-in",
        }}
        data-component="image-dialog-viewport"
        data-zoom={zoom()}
        onClick={(event) => {
          if (dragged || event.detail > 1) return
          change(clickZoom(zoom()), { x: event.clientX, y: event.clientY })
        }}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          const next = keyZoom(event.key, zoom())
          if (next === null) return
          event.preventDefault()
          if (!event.repeat || (event.key !== "Enter" && event.key !== " ")) change(next)
        }}
        onPointerDown={(event) => {
          if (drag) return
          dragged = false
          if (event.pointerType !== "mouse" || event.button !== 0 || zoom() <= 1) return
          const bounds = viewport.getBoundingClientRect()
          if (
            event.clientX - bounds.left >= viewport.clientWidth ||
            event.clientY - bounds.top >= viewport.clientHeight
          )
            return
          drag = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: viewport.scrollLeft,
            top: viewport.scrollTop,
          }
          viewport.setPointerCapture(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={(event) => {
          if (!drag || drag.pointerId !== event.pointerId) return
          if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) dragged = true
          viewport.scrollLeft = drag.left - (event.clientX - drag.x)
          viewport.scrollTop = drag.top - (event.clientY - drag.y)
        }}
        onPointerUp={endDrag}
        onLostPointerCapture={endDrag}
      >
        <img
          src={props.src}
          alt={props.name}
          draggable={false}
          class="block max-w-none select-none"
          style={
            natural().width
              ? { width: `${width()}px`, height: `${height()}px` }
              : { "max-width": "calc(92vw - 96px)", "max-height": `${maxHeight(window_())}px` }
          }
          onLoad={(event) => {
            setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            if (!waiting()) return
            setWaiting(false)
            if (props.from?.isConnected) flip(viewport, props.from.getBoundingClientRect(), "in")
          }}
          onError={() => {
            setWaiting(false)
            props.onError()
          }}
        />
      </div>
      <span id={hint} class="sr-only">
        Click to zoom in or return to fit. Scroll to zoom, drag to pan. Use Enter to toggle zoom, plus or minus to zoom,
        and 0 to fit.
      </span>
      <span class="sr-only" aria-live="polite">
        {Math.round(zoom() * 100)}% zoom
      </span>
    </div>
  )
}
