import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { makeEventListener } from "@solid-primitives/event-listener"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, MinusIcon, PlusIcon, ScanIcon } from "@kiko/ui/icons"
import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import type { ViewerItem } from "./mediaViewer"
import {
  ZOOM_FIT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampOffset,
  scaleOffset,
  zoomBounds,
  type ZoomOffset,
} from "./zoom"
import {
  containRect,
  flightCss,
  flightTransform,
  lockAxis,
  pinchScale,
  resolveSwipe,
  type Box,
  type SwipeAxis,
} from "./gestures"
import "./mediaViewer.css"

/**
 * The full-screen media viewer: tweb's `mediaViewer` reduced to what kiko
 * actually has, a stage, a caption, a counter, a switcher and a zoom pill.
 * Loaded as a tier 3 chunk by `mediaViewer.tsx`, which owns the open state.
 *
 * The shell is `ModalV2`, so the focus trap, escape-to-close, `aria-modal`, the
 * focus restore, the scroll lock and the outside-pointer-events suppression are
 * Kobalte's. Escape is the dialog's; it reaches `requestClose` through
 * `onOpenChange`.
 *
 * Motion is the open and close flight and nothing else: the picture moves
 * between its thumbnail's rectangle and its fitted rectangle with a transform,
 * and the backdrop and chrome fade with opacity. Both run on the compositor, and
 * every rectangle is read in one pass before any style is written, so the
 * animation frames contain no layout. Switching items is a swap, not a slide.
 * Reduced motion removes the flight.
 */

/**
 * Below this much travel a pointer gesture is a click, and must not be treated
 * as a drag: a click on a photo zooms, and a click that lands after a pan
 * would zoom as well.
 */
const DRAG_THRESHOLD = 4

/** What a click on a fitted photo zooms to. tweb's double-tap does the same. */
const CLICK_ZOOM = 2

/** Two taps this close in time and place are a double tap. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP = 24

const FLIGHT_MS = 220
const FLIGHT_EASING = "cubic-bezier(0.2, 0, 0, 1)"

/** The thumbnail's box, or nothing when it is gone or scrolled out of the window. */
function visibleBox(element: Element | null | undefined): Box | undefined {
  if (!element?.isConnected) return undefined
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return undefined
  if (rect.bottom <= 0 || rect.right <= 0) return undefined
  if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return undefined
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

const toBox = (rect: DOMRect): Box => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
})

/** What a drag has to have actually moved before it counts as a swipe. */
interface Drag {
  pointerId: number
  /** Where the pointer went down, in client coordinates. */
  x: number
  y: number
  /** The pan and the scale it started from, so the drag is absolute not incremental. */
  pan: ZoomOffset
  scale: number
}

export default function MediaViewer(props: {
  items: readonly ViewerItem[]
  index: number
  caption?: string
  /** The thumbnail that was opened, so the picture can fly from it and back. */
  origin?: HTMLElement
  onIndex: (index: number) => void
  onClose: () => void
}) {
  let stage: HTMLDivElement | undefined
  let player: HTMLVideoElement | undefined
  onCleanup(() => {
    player?.pause()
    player?.removeAttribute("src")
    player?.load()
    player = undefined
  })
  const [scale, setScale] = createSignal(ZOOM_FIT)
  const [pan, setPan] = createSignal<ZoomOffset>({ x: 0, y: 0 })
  const [dragging, setDragging] = createSignal(false)
  /** How far a swipe has pulled the picture off centre. */
  const [swipe, setSwipe] = createSignal({ x: 0, y: 0 })
  const [entering, setEntering] = createSignal(true)
  let closing = false
  let root: HTMLDivElement | undefined
  let backdrop: HTMLDivElement | undefined
  let canvas: HTMLDivElement | undefined
  const openedAt = props.index

  const item = createMemo(() => props.items[props.index])
  const isPhoto = createMemo(() => item()?.kind === "photo")
  const title = createMemo(() =>
    (props.caption?.trim().length ?? 0) > 0 ? props.caption : item()?.alt
  )

  const canvasTransform = () =>
    `translate(${swipe().x}px, ${swipe().y}px) scale(${scale()}) translate(${-pan().x}px, ${-pan().y}px)`
  /** A downward or upward pull fades the backdrop out as the picture leaves. */
  const backdropOpacity = () => 1 - Math.min(1, Math.abs(swipe().y) / (window.innerHeight * 0.6)) * 0.8

  const hasPrevious = () => props.index > 0
  const hasNext = () => props.index < props.items.length - 1

  /** --- zoom ------------------------------------------------------------- */

  /**
   * Move to `next`, holding `point` — or the middle of the stage — still.
   *
   * The stage box is what the pointer is measured against and what the pan
   * walls are computed from, and it is deliberately NOT the element the
   * transform lands on: a transformed box measures itself scaled, which would
   * count the zoom twice. `media-viewer-canvas` inside it takes the transform.
   */
  const changeScale = (next: number, point?: { clientX: number; clientY: number }) => {
    const element = stage
    // A video is never zoomed: its controls are drawn in its own pixels, so
    // scaling the box would scale them and leave the reader scrubbing a
    // one-pixel-tall progress bar.
    if (!element || !isPhoto()) return

    const box = element.getBoundingClientRect()
    const rect = { width: box.width, height: box.height }
    const target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    const delta = scaleOffset({
      x: point ? point.clientX - box.left : box.width / 2,
      y: point ? point.clientY - box.top : box.height / 2,
      scale: target,
      prevScale: scale(),
      rect,
    })

    setScale(target)
    setPan(
      clampOffset({
        x: pan().x + delta.x,
        y: pan().y + delta.y,
        bounds: zoomBounds(rect, target),
      }),
    )
  }

  const fit = () => {
    setScale(ZOOM_FIT)
    setPan({ x: 0, y: 0 })
  }

  // Zoom is per item and never leaks: the next item is a different picture, and
  // a zoom chosen while reading one says nothing about the next.
  createEffect(on(() => props.index, fit, { defer: true }))

  /** --- switching -------------------------------------------------------- */

  const step = (delta: number) => {
    const next = props.index + delta
    if (next < 0 || next >= props.items.length) return
    props.onIndex(next)
  }

  /** --- pointer ---------------------------------------------------------- */

  const pointers = new Map<number, { x: number; y: number }>()
  let drag: Drag | null = null
  let pinch: { distance: number; scale: number } | null = null
  let axis: SwipeAxis | null = null
  let lastTap: { time: number; x: number; y: number } | null = null
  /** A gesture that travelled still ends in a tap; this voids it. */
  let dragged = false

  const spread = () => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const endGesture = (event: PointerEvent, commit: boolean) => {
    const element = stage
    const active = drag
    pointers.delete(event.pointerId)
    if (element?.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)

    if (pinch) {
      // The finger left behind is not a drag: it would pan from where it was.
      if (pointers.size < 2) {
        pinch = null
        drag = null
      }
    } else if (active?.pointerId === event.pointerId) {
      drag = null
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      const result =
        commit && active.scale <= ZOOM_FIT
          ? resolveSwipe({
              axis,
              dx,
              dy,
              width: window.innerWidth,
              height: window.innerHeight,
              hasPrevious: hasPrevious(),
              hasNext: hasNext(),
            })
          : "stay"
      if (result === "close") {
        void requestClose()
      } else {
        setSwipe({ x: 0, y: 0 })
        if (result === "previous") step(-1)
        else if (result === "next") step(1)
      }
      if (commit && !dragged) {
        const now = event.timeStamp
        if (
          lastTap &&
          now - lastTap.time < DOUBLE_TAP_MS &&
          Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_SLOP
        ) {
          lastTap = null
          changeScale(scale() > ZOOM_FIT ? ZOOM_FIT : CLICK_ZOOM, {
            clientX: event.clientX,
            clientY: event.clientY,
          })
        } else {
          lastTap = { time: now, x: event.clientX, y: event.clientY }
        }
      }
    }
    if (pointers.size === 0) setDragging(false)
  }

  const onPointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    const element = stage
    if (!element || closing || !isPhoto()) return
    if (event.pointerType === "mouse" && event.button !== 0) return
    // The picture under the pointer moves as it is panned, so without capture
    // the drag dies on the first pixel of travel.
    element.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setDragging(true)
    dragged = false
    axis = null
    if (pointers.size === 2) {
      pinch = { distance: spread(), scale: scale() }
      drag = null
      setSwipe({ x: 0, y: 0 })
    } else if (pointers.size === 1) {
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        pan: pan(),
        scale: scale(),
      }
    }
  }

  const onPointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    const element = stage
    const known = pointers.get(event.pointerId)
    if (!element || !known) return
    known.x = event.clientX
    known.y = event.clientY

    if (pinch) {
      if (pointers.size < 2) return
      const [a, b] = [...pointers.values()]
      dragged = true
      changeScale(pinchScale(pinch.scale, pinch.distance, spread()), {
        clientX: (a.x + b.x) / 2,
        clientY: (a.y + b.y) / 2,
      })
      return
    }

    const active = drag
    if (!active || active.pointerId !== event.pointerId) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) dragged = true

    if (active.scale > ZOOM_FIT) {
      setPan(
        clampOffset({
          x: active.pan.x - dx / active.scale,
          y: active.pan.y - dy / active.scale,
          bounds: zoomBounds(element.getBoundingClientRect(), active.scale),
        }),
      )
      return
    }
    // At fit there is nothing to pan, so the drag is a swipe: the picture
    // follows the finger on its axis and the release decides.
    axis ??= lockAxis(dx, dy)
    if (axis === "x") setSwipe({ x: dx, y: 0 })
    else if (axis === "y") setSwipe({ x: 0, y: dy })
  }

  onMount(() => {
    const element = stage
    if (!element) return

    // `passive: false` is load-bearing: the wheel zoom has to cancel the
    // scroll, or the app behind the viewer moves as the picture magnifies.
    makeEventListener(
      element,
      "wheel",
      (event) => {
        if (!isPhoto() || event.deltaY === 0) return
        event.preventDefault()
        const delta =
          event.deltaY *
          (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
        // A trackpad pinch arrives as a ctrl-wheel and wants to be several
        // times finer than a wheel notch.
        changeScale(scale() * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)), {
          clientX: event.clientX,
          clientY: event.clientY,
        })
      },
      { passive: false },
    )

    // The pointer can be released anywhere — out of the window, onto system
    // chrome — and the capture is lost with it. Without this the cursor keeps
    // saying `grabbing` over a picture that no longer pans.
    makeEventListener(element, "lostpointercapture", (event) => {
      if (pointers.has(event.pointerId)) endGesture(event, false)
    })
  })

  /** --- flight ---------------------------------------------------------- */

  const thumbFor = (index: number): Element | undefined => (index === openedAt ? props.origin : undefined)

  const fades = () => (root ? [...root.querySelectorAll("[data-viewer-fade]")] : [])

  /**
   * Fly the picture between the thumbnail and its fitted place. Every box is
   * read first, then the animations are started, so no animation frame has a
   * layout in it. Transform and opacity only: both run on the compositor.
   */
  const fly = async (direction: "open" | "close") => {
    const element = stage
    const layer = canvas
    if (!element || !layer) return
    const opening = direction === "open"

    // read
    const stageBox = toBox(element.getBoundingClientRect())
    const thumb = visibleBox(thumbFor(props.index))
    const media = item()
    const image = layer.querySelector("img, video")
    const natural =
      image instanceof HTMLImageElement
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : image instanceof HTMLVideoElement
          ? { width: image.videoWidth, height: image.videoHeight }
          : { width: 0, height: 0 }
    const picture = containRect(stageBox, {
      width: media?.width || natural.width,
      height: media?.height || natural.height,
    })
    const resting = canvasTransform()
    const shade = backdropOpacity()

    // write
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const options: KeyframeAnimationOptions = {
      duration: reduced ? 0 : FLIGHT_MS,
      easing: FLIGHT_EASING,
      fill: "both",
    }
    const away = thumb ? flightCss(flightTransform(picture, thumb)) : undefined
    const animations: Animation[] = []
    if (opening) {
      animations.push(
        layer.animate(
          away
            ? [{ transform: away }, { transform: "none" }]
            : [{ opacity: 0 }, { opacity: 1 }],
          options,
        ),
      )
    } else {
      animations.push(
        layer.animate(
          away
            ? [{ transform: resting }, { transform: away }]
            : [{ transform: resting, opacity: 1 }, { transform: resting, opacity: 0 }],
          options,
        ),
      )
    }
    const shades = opening ? [0, 1] : [shade, 0]
    for (const target of [backdrop, ...fades()]) {
      if (target) animations.push(target.animate({ opacity: shades }, options))
    }
    if (opening) setEntering(false)
    await Promise.allSettled(animations.map((animation) => animation.finished))
    if (opening) for (const animation of animations) animation.cancel()
  }

  const requestClose = async () => {
    if (closing) return
    closing = true
    await fly("close")
    props.onClose()
  }

  onMount(() => {
    let tries = 0
    const start = () => {
      if (stage?.isConnected && canvas?.isConnected) void fly("open")
      else if (tries++ < 30) requestAnimationFrame(start)
      else setEntering(false)
    }
    start()
  })

  /** --- keyboard --------------------------------------------------------- */

  //
  // On the modal, not on the window: a global listener would keep answering
  // while the viewer is closed, and a key pressed in the composer would step the
  // zoom of a viewer nobody can see. Escape is Kobalte's and is not here.

  const onKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    // The range in the zoom pill and the player's own controls already own
    // these keys; handling them twice would fight them.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLVideoElement) return

    switch (event.key) {
      case "ArrowRight":
      case "ArrowLeft":
        // tweb ignores navigation while zoomed (`base.ts:1146`): at zoom the
        // picture is being read, and the arrow belongs to the pan, not to the
        // next item.
        if (scale() > ZOOM_FIT) return
        event.preventDefault()
        step(event.key === "ArrowRight" ? 1 : -1)
        return
      case "+":
      case "=":
        event.preventDefault()
        changeScale(scale() + ZOOM_STEP)
        return
      case "-":
      case "_":
        event.preventDefault()
        changeScale(scale() - ZOOM_STEP)
        return
      case "0":
        event.preventDefault()
        fit()
        return
      case " ":
        if (event.target instanceof HTMLElement && event.target.closest("button, a, input")) return
        if (!player) return
        event.preventDefault()
        if (player.paused) void player.play()
        else player.pause()
        return
    }
  }

  /** --- render ----------------------------------------------------------- */

  return (
    <ModalV2
      open
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) void requestClose()
      }}
    >
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          ref={root}
          class="media-viewer"
          classList={{ "media-viewer--photo": isPhoto(), "media-viewer--entering": entering() }}
          onKeyDown={onKeyDown}
        >
          <div
            ref={backdrop}
            class="media-viewer-backdrop"
            style={{ opacity: backdropOpacity() }}
          />
          <div class="media-viewer-topbar" data-viewer-fade>
            <button
              type="button"
              class="media-viewer-icon-button"
              aria-label="Close"
              onClick={() => void requestClose()}
            >
              <HugeIcon icon={CloseIcon} size={24} aria-hidden="true" />
            </button>

            {/* The dialog's accessible name, so it is real text: a viewer with a
                picture and nothing naming it is a viewer you cannot tell what
                you are looking at. */}
            <ModalV2.Title class="media-viewer-caption">
              {title()}
            </ModalV2.Title>

            <Show when={props.items.length > 1}>
              <span class="media-viewer-counter" aria-live="polite">
                {props.index + 1} / {props.items.length}
              </span>
            </Show>
          </div>

          <div
            ref={stage}
            class="media-viewer-stage"
            // `undefined`, not `false`: Solid writes `data-zoomed="false"`
            // rather than dropping the attribute, and a `[data-zoomed]`
            // selector would then match every fitted picture.
            data-zoomed={scale() > ZOOM_FIT ? "" : undefined}
            data-dragging={dragging() ? "" : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => endGesture(event, true)}
            onPointerCancel={(event) => endGesture(event, false)}
          >
            <div
              ref={canvas}
              class="media-viewer-canvas"
              style={isPhoto() ? { transform: canvasTransform() } : undefined}
            >
              <Show
                when={isPhoto()}
                fallback={
                  <video
                    ref={player}
                    class="media-viewer-video"
                    controls
                    playsinline
                    poster={item()?.poster}
                    src={item()?.src}
                  />
                }
              >
                <img
                  class="media-viewer-image"
                  src={item()?.src}
                  alt={item()?.alt}
                  draggable={false}
                />
              </Show>
            </div>
          </div>

          <button
            type="button"
            class="media-viewer-sibling media-viewer-sibling--previous"
            data-viewer-fade
            classList={{ "media-viewer-sibling--hidden": !hasPrevious() }}
            aria-label="Previous item"
            onClick={() => step(-1)}
          >
            <HugeIcon icon={ChevronLeftIcon} size={24} aria-hidden="true" />
          </button>

          <button
            type="button"
            class="media-viewer-sibling media-viewer-sibling--next"
            data-viewer-fade
            classList={{ "media-viewer-sibling--hidden": !hasNext() }}
            aria-label="Next item"
            onClick={() => step(1)}
          >
            <HugeIcon icon={ChevronRightIcon} size={24} aria-hidden="true" />
          </button>

          {/* A clip's own controls are its zoom, so the pill is a photo's only. */}
          <Show when={isPhoto()}>
            <div class="media-viewer-zoom-pill" data-viewer-fade>
              <button
                type="button"
                class="media-viewer-icon-button"
                aria-label="Zoom out"
                onClick={() => changeScale(scale() - ZOOM_STEP)}
              >
                <HugeIcon icon={MinusIcon} size={24} aria-hidden="true" />
              </button>
              <input
                class="media-viewer-zoom-range"
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                value={scale()}
                aria-label="Zoom level"
                onInput={(event) => changeScale(Number(event.currentTarget.value))}
              />
              <button
                type="button"
                class="media-viewer-icon-button"
                aria-label="Zoom in"
                onClick={() => changeScale(scale() + ZOOM_STEP)}
              >
                <HugeIcon icon={PlusIcon} size={24} aria-hidden="true" />
              </button>
              <button
                type="button"
                class="media-viewer-icon-button"
                aria-label="Fit to the window"
                onClick={fit}
              >
                <HugeIcon icon={ScanIcon} size={24} aria-hidden="true" />
              </button>
            </div>
          </Show>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
