import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createPerPointerListeners } from "@solid-primitives/pointer"
import { createWindowSize } from "@solid-primitives/resize-observer"
import { Scan, X, ZoomIn, ZoomOut } from "lucide-solid"
import { Show, createEffect, createMemo, createSignal, on, onMount, type JSX } from "solid-js"
import "./lightbox.css"

/**
 * A full-screen image viewer: zoom at the pointer, drag to pan, wheel to zoom,
 * escape to close. Ported from t3code's `ZoomableImage` + `ExpandedImageDialog`,
 * with the shell reduced to what an image actually needs — the asset-URL
 * refresh, the media action bar, the accessibility-text panel and the gallery
 * navigation all belong to t3code's data model and none of it comes with an
 * `src`.
 *
 * The shell is `ModalV2` (Kobalte's Dialog): the focus trap, escape,
 * `aria-modal`, the focus restore and the scroll lock are the primitive's and
 * are not reimplemented. Everything below the shell is this file's.
 */

/** Measured against t3code. Above 8 the pixels are mush and the pan is unusable. */
const MAX_ZOOM = 8

/** A keypress of an arrow, one nudge of the viewport. */
const PAN_STEP = 40

/** Below this much travel it is a click, not a drag, and must not be treated as one. */
const DRAG_THRESHOLD = 4

export interface LightboxImage {
  src: string
  name: string
}

export interface LightboxProps {
  image: LightboxImage
  onClose: () => void
}

interface Point {
  x: number
  y: number
}

/** A drag in progress, in client coordinates plus the scroll it started from. */
interface Drag {
  pointerId: number
  x: number
  y: number
  left: number
  top: number
}

/**
 * What has to survive the gap between "the pointer is here" and "the scroll has
 * been corrected for the new size".
 */
interface Anchor {
  /** The held point, in unscaled image-content coordinates. */
  x: number
  y: number
  /** Where that point sat on screen, so it can be put back after the box moves. */
  clientX: number
  clientY: number
}

export function Lightbox(props: LightboxProps) {
  let viewport: HTMLDivElement | undefined

  const [natural, setNatural] = createSignal({ width: 0, height: 0 })
  const [zoom, setZoom] = createSignal(1)
  const [dragging, setDragging] = createSignal(false)

  const windowSize = createWindowSize()

  // --- geometry ------------------------------------------------------------
  //
  // t3code's numbers, unchanged. `min(1, …)` means an image smaller than the
  // window is shown at its own size and never blown up to fill — the viewer
  // magnifies, it does not resample a thumbnail.

  const maxHeight = createMemo(() =>
    Math.max(1, Math.min(windowSize.height * 0.86, windowSize.height - 160)),
  )

  const fit = createMemo(() =>
    Math.min(
      1,
      (windowSize.width * 0.92 - (windowSize.width >= 640 ? 96 : 0)) / (natural().width || 1),
      maxHeight() / (natural().height || 1),
    ),
  )

  /** `undefined` until the image reports its intrinsic size. */
  const rendered = createMemo(() => {
    const size = natural()
    if (!size.width) return undefined
    const scale = fit() * zoom()
    return { width: `${size.width * scale}px`, height: `${size.height * scale}px` }
  })

  // --- zoom ----------------------------------------------------------------

  /**
   * Zoom to `next`, holding `point` (a client coordinate) still.
   *
   * The scroll is corrected AFTER `setZoom` has written the new size: the
   * element's own box moves when it grows, because the shell centres it, so the
   * bounds that have to be subtracted are the post-update ones. Solid flushes a
   * signal's dependent DOM writes synchronously here — this runs from an event
   * handler, never inside a batch — which is what makes that ordering safe.
   */
  const changeZoom = (next: number, point?: Point) => {
    const element = viewport
    if (!element) return
    const previous = zoom()
    const clamped = Math.min(MAX_ZOOM, Math.max(1, next))
    if (previous === clamped) return

    const bounds = element.getBoundingClientRect()
    const x = point ? point.x - bounds.left : element.clientWidth / 2
    const y = point ? point.y - bounds.top : element.clientHeight / 2
    const held: Anchor = {
      x: (element.scrollLeft + x) / previous,
      y: (element.scrollTop + y) / previous,
      clientX: bounds.left + x,
      clientY: bounds.top + y,
    }

    setZoom(clamped)

    const after = element.getBoundingClientRect()
    element.scrollLeft = held.x * clamped - (held.clientX - after.left)
    element.scrollTop = held.y * clamped - (held.clientY - after.top)
  }

  /** Arrow-key panning. False when the key is not ours or there is nowhere to go. */
  const pan = (key: string) => {
    const element = viewport
    if (!element || zoom() <= 1) return false
    // A vertical scrollbar alone must not swallow the key.
    if ((key === "ArrowLeft" || key === "ArrowRight") && element.scrollWidth <= element.offsetWidth)
      return false
    switch (key) {
      case "ArrowLeft":
        element.scrollLeft -= PAN_STEP
        break
      case "ArrowRight":
        element.scrollLeft += PAN_STEP
        break
      case "ArrowUp":
        element.scrollTop -= PAN_STEP
        break
      case "ArrowDown":
        element.scrollTop += PAN_STEP
        break
      default:
        return false
    }
    return true
  }

  // A resize re-fits the image, so any zoom the reader had chosen no longer
  // describes what they were looking at. `defer` keeps the initial pass — the
  // one where nothing has changed yet — from resetting a zoom to 1.
  createEffect(
    on(
      [() => windowSize.width, () => windowSize.height],
      () => changeZoom(1),
      { defer: true },
    ),
  )

  // --- drag to pan ---------------------------------------------------------

  let drag: Drag | null = null
  /** A drag that ends over the element still fires `click`; this is what voids it. */
  let suppressClick = false

  createPerPointerListeners({
    // The cast is the primitive's signature being narrower than its own code:
    // it attaches through `createEventListener`, which tolerates an undefined
    // target until the ref lands.
    target: (() => viewport) as () => EventTarget,
    pointerTypes: ["mouse"],
    passive: false,
    onDown(event, onMove, onUp) {
      const element = viewport
      if (!element || drag) return
      suppressClick = false
      if (event.button !== 0 || zoom() <= 1) return

      // Press in the scrollbar gutter is a scrollbar drag, not a pan.
      const bounds = element.getBoundingClientRect()
      if (
        event.clientX - bounds.left >= element.clientWidth ||
        event.clientY - bounds.top >= element.clientHeight
      )
        return

      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
      }
      // `createPerPointerListeners` does NOT capture the pointer, and the
      // element under the cursor moves as we scroll, so without this the drag
      // dies on the first pixel of travel.
      element.setPointerCapture(event.pointerId)
      setDragging(true)

      onMove((moveEvent) => {
        const active = drag
        const target = viewport
        if (!active || !target || active.pointerId !== moveEvent.pointerId) return
        if (Math.hypot(moveEvent.clientX - active.x, moveEvent.clientY - active.y) > DRAG_THRESHOLD) {
          suppressClick = true
        }
        target.scrollLeft = active.left - (moveEvent.clientX - active.x)
        target.scrollTop = active.top - (moveEvent.clientY - active.y)
      })

      onUp((upEvent) => {
        const target = viewport
        if (target?.hasPointerCapture(upEvent.pointerId)) {
          target.releasePointerCapture(upEvent.pointerId)
        }
        drag = null
        setDragging(false)
      })
    },
  })

  onMount(() => {
    const element = viewport
    if (!element) return

    // `passive: false` is load-bearing: the wheel zoom has to cancel the
    // scroll, or the page moves under the viewer as it magnifies.
    makeEventListener(
      element,
      "wheel",
      (event) => {
        if (event.deltaY === 0) return
        event.preventDefault()
        const delta =
          event.deltaY *
          (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
        changeZoom(zoom() * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)), {
          x: event.clientX,
          y: event.clientY,
        })
      },
      { passive: false },
    )

    // The pointer can be released anywhere — out of the window, onto a system
    // chrome — and the capture is lost with it. Without this the cursor stays
    // `grabbing` over a viewer that no longer pans.
    makeEventListener(element, "lostpointercapture", () => {
      drag = null
      setDragging(false)
    })
  })

  // --- keyboard ------------------------------------------------------------
  //
  // On the modal, not on the viewport: focus lands on the viewport when the
  // lightbox opens but a click moves it into the control bar, and the viewer's
  // keys have to work from either.

  const onKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault()
        if (!event.repeat) changeZoom(zoom() > 1 ? 1 : 2)
        return
      case "+":
      case "=":
        event.preventDefault()
        changeZoom(zoom() * 1.5)
        return
      case "-":
        event.preventDefault()
        changeZoom(zoom() / 1.5)
        return
      case "0":
        event.preventDefault()
        changeZoom(1)
        return
    }
    if (pan(event.key)) event.preventDefault()
  }

  return (
    <ModalV2
      open
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) props.onClose()
      }}
    >
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          class="lightbox"
          onPointerDownOutside={() => props.onClose()}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            viewport?.focus({ preventScroll: true })
          }}
          onKeyDown={onKeyDown}
        >
          <ModalV2.Title class="lightbox-caption">{props.image.name}</ModalV2.Title>

          <div
            ref={viewport}
            class="lightbox-viewport"
            classList={{ "lightbox-viewport--zoomed": zoom() > 1 }}
            // `undefined`, not `false`: Solid writes `data-dragging="false"`
            // rather than dropping the attribute, and a `[data-dragging]`
            // selector would then match every idle viewer.
            data-dragging={dragging() ? "" : undefined}
            role="region"
            aria-label={`${props.image.name}, zoomable image`}
            aria-description="Click to zoom in or return to fit. Scroll to zoom, drag to pan. Use Enter to toggle zoom, plus or minus to zoom, and 0 to fit."
            tabIndex={0}
            style={{ width: rendered()?.width, height: rendered()?.height }}
            onClick={(event) => {
              if (suppressClick || event.detail > 1) return
              changeZoom(zoom() > 1 ? 1 : 2, { x: event.clientX, y: event.clientY })
            }}
          >
            <img
              class="lightbox-image"
              src={props.image.src}
              alt={props.image.name}
              draggable={false}
              style={
                rendered() ?? {
                  "max-width": "min(92vw, calc(92vw - 96px))",
                  "max-height": `${maxHeight()}px`,
                }
              }
              onLoad={(event) => {
                const image = event.currentTarget
                setNatural({ width: image.naturalWidth, height: image.naturalHeight })
              }}
            />
          </div>

          <span class="lightbox-status" aria-live="polite">
            {Math.round(zoom() * 100)}% zoom
          </span>

          <div class="lightbox-bar">
            <button
              type="button"
              class="lightbox-button"
              aria-label="Zoom out"
              disabled={zoom() <= 1}
              onClick={() => changeZoom(zoom() / 1.5)}
            >
              <ZoomOut aria-hidden="true" />
            </button>
            <button
              type="button"
              class="lightbox-button"
              aria-label="Fit to window"
              disabled={zoom() <= 1}
              onClick={() => changeZoom(1)}
            >
              <Scan aria-hidden="true" />
            </button>
            <button
              type="button"
              class="lightbox-button"
              aria-label="Zoom in"
              disabled={zoom() >= MAX_ZOOM}
              onClick={() => changeZoom(zoom() * 1.5)}
            >
              <ZoomIn aria-hidden="true" />
            </button>
            <button
              type="button"
              class="lightbox-button lightbox-button--close"
              aria-label="Close image preview"
              onClick={() => props.onClose()}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}

export interface LightboxController {
  /** Wire this to the message image's and the composer's thumbnail's `onClick`. */
  open: (image: LightboxImage) => void
  /** Render this once, anywhere in the tree. */
  view: JSX.Element
}

/**
 * Owns the lightbox's open state for a trigger that only forwards a click.
 *
 * The opener is captured HERE, at open time, not read on close: closing focuses
 * whatever was focused when the lightbox opened, and by then the click that
 * opened it has already moved focus — so a read on close would restore focus
 * to the viewer itself, which is gone. Kobalte restores focus to its trigger,
 * and this component has none: the lightbox is opened by an `onClick` on a
 * thumbnail, not by a `Dialog.Trigger`.
 */
export function createLightbox(): LightboxController {
  const [image, setImage] = createSignal<LightboxImage | null>(null)
  let opener: HTMLElement | null = null

  const close = () => {
    setImage(null)
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    opener = null
  }

  return {
    open: (next) => {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setImage(next)
    },
    view: (
      <Show when={image()}>
        {(current) => <Lightbox image={current()} onClose={close} />}
      </Show>
    ),
  }
}
