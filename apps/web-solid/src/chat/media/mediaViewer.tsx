import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createPerPointerListeners } from "@solid-primitives/pointer"
import { ChevronLeft, ChevronRight, Minus, Plus, Scan, X } from "lucide-solid"
import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import type { MediaItem } from "../../lib/types"
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
import "./mediaViewer.css"

/**
 * The full-screen media viewer: tweb's `mediaViewer` reduced to what kiko
 * actually has — a stage, a caption, a counter, a switcher and a zoom pill.
 *
 * The shell is `ModalV2`, so the focus trap, escape-to-close, `aria-modal`, the
 * focus restore, the scroll lock and the outside-pointer-events suppression are
 * Kobalte's and are not reimplemented here. Escape in particular: it is the
 * dialog's, and adding a second one would double-fire the close.
 *
 * What is ported is the interaction: zoom about the pointer (`base.ts:708`,
 * `calculateScaleOffset`), the pan walls (`calculateOffsetBoundaries`), the
 * switcher and its hidden-at-the-end states (`base.ts:427-447`), the swipe
 * (`base.ts:550`), and the keyboard (`base.ts:1137`). What is NOT ported is
 * tweb's motion: the shared-element open/close transition, the slide between
 * items and the zoom bounce-back. kiko's viewer appears and disappears
 * instantly and a switch is a swap — see `mediaViewer.css`, which has no
 * transition, no animation and no keyframes in it at all.
 */

/** tweb's `percents > .2` against the window (`base.ts:550`). */
const SWIPE_FRACTION = 0.2

/**
 * Below this much travel a pointer gesture is a click, and must not be treated
 * as a drag: a click on a photo zooms, and a click that lands after a pan
 * would zoom as well.
 */
const DRAG_THRESHOLD = 4

/** What a click on a fitted photo zooms to. tweb's double-tap does the same. */
const CLICK_ZOOM = 2

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

function MediaViewer(props: {
  items: readonly MediaItem[]
  index: number
  caption?: string
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

  const item = createMemo(() => props.items[props.index])
  const isPhoto = createMemo(() => item()?.kind === "photo")
  const title = createMemo(() =>
    (props.caption?.trim().length ?? 0) > 0 ? props.caption : item()?.alt
  )

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

  let drag: Drag | null = null
  /** A gesture that travelled still ends in a click on the picture; this voids it. */
  let dragged = false

  createPerPointerListeners({
    // The cast is the primitive's signature being narrower than its own code:
    // it attaches through `createEventListener`, which tolerates an undefined
    // target until the ref lands.
    target: (() => stage) as () => EventTarget,
    passive: false,
    onDown(event, onMove, onUp) {
      const element = stage
      if (!element || drag || event.button !== 0 || !isPhoto()) return

      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        pan: pan(),
        scale: scale(),
      }
      dragged = false
      // `createPerPointerListeners` does not capture the pointer, and the
      // picture under the cursor moves as it is panned, so without this the
      // drag dies on the first pixel of travel.
      element.setPointerCapture(event.pointerId)
      setDragging(true)

      onMove((moveEvent) => {
        const active = drag
        if (!active || active.pointerId !== moveEvent.pointerId) return
        const dx = moveEvent.clientX - active.x
        const dy = moveEvent.clientY - active.y
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) dragged = true
        // At fit there is nothing to pan — `zoomBounds` is a point — so the same
        // gesture is a swipe to the next item, which tweb decides on release.
        if (active.scale <= ZOOM_FIT) return

        setPan(
          clampOffset({
            x: active.pan.x - dx / active.scale,
            y: active.pan.y - dy / active.scale,
            bounds: zoomBounds(element.getBoundingClientRect(), active.scale),
          }),
        )
      })

      onUp((upEvent) => {
        const active = drag
        // A cancelled gesture — the pointer handed to the system, the tab
        // switched — is not a swipe, and it must not page the album.
        if (upEvent.type === "pointerup" && active?.pointerId === upEvent.pointerId) {
          const travel = upEvent.clientX - active.x
          // tweb's direction (`base.ts:552`): a drag to the right goes back.
          if (active.scale <= ZOOM_FIT && Math.abs(travel) > SWIPE_FRACTION * window.innerWidth) {
            step(travel > 0 ? -1 : 1)
          }
        }
        if (element.hasPointerCapture(upEvent.pointerId)) {
          element.releasePointerCapture(upEvent.pointerId)
        }
        drag = null
        setDragging(false)
      })
    },
  })

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
    makeEventListener(element, "lostpointercapture", () => {
      drag = null
      setDragging(false)
    })
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
        if (!isOpen) props.onClose()
      }}
    >
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          class="media-viewer"
          classList={{ "media-viewer--photo": isPhoto() }}
          onKeyDown={onKeyDown}
        >
          <div class="media-viewer-topbar">
            <button
              type="button"
              class="media-viewer-icon-button"
              aria-label="close"
              onClick={() => props.onClose()}
            >
              <X aria-hidden="true" />
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
            onClick={(event) => {
              if (dragged || event.detail > 1 || !isPhoto()) return
              changeScale(scale() > ZOOM_FIT ? ZOOM_FIT : CLICK_ZOOM, {
                clientX: event.clientX,
                clientY: event.clientY,
              })
            }}
          >
            <div
              class="media-viewer-canvas"
              style={
                isPhoto()
                  ? { transform: `scale(${scale()}) translate(${-pan().x}px, ${-pan().y}px)` }
                  : undefined
              }
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
            classList={{ "media-viewer-sibling--hidden": !hasPrevious() }}
            aria-label="previous item"
            onClick={() => step(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </button>

          <button
            type="button"
            class="media-viewer-sibling media-viewer-sibling--next"
            classList={{ "media-viewer-sibling--hidden": !hasNext() }}
            aria-label="next item"
            onClick={() => step(1)}
          >
            <ChevronRight aria-hidden="true" />
          </button>

          {/* A clip's own controls are its zoom, so the pill is a photo's only. */}
          <Show when={isPhoto()}>
            <div class="media-viewer-zoom-pill">
              <button
                type="button"
                class="media-viewer-icon-button"
                aria-label="zoom out"
                onClick={() => changeScale(scale() - ZOOM_STEP)}
              >
                <Minus aria-hidden="true" />
              </button>
              <input
                class="media-viewer-zoom-range"
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                value={scale()}
                aria-label="zoom level"
                onInput={(event) => changeScale(Number(event.currentTarget.value))}
              />
              <button
                type="button"
                class="media-viewer-icon-button"
                aria-label="zoom in"
                onClick={() => changeScale(scale() + ZOOM_STEP)}
              >
                <Plus aria-hidden="true" />
              </button>
              <button
                type="button"
                class="media-viewer-icon-button"
                aria-label="fit to the window"
                onClick={fit}
              >
                <Scan aria-hidden="true" />
              </button>
            </div>
          </Show>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}

export interface MediaViewerController {
  /** Wire this to a thumbnail's `onClick`. */
  open(items: readonly MediaItem[], index: number, caption?: string): void
  /** Render this once, anywhere in the tree. */
  view: JSX.Element
}

/**
 * Owns the viewer's open state for a trigger that only forwards a click.
 *
 * The opener is captured HERE, at open time, not read on close: closing focuses
 * whatever was focused when the viewer opened, and by then the click that
 * opened it has already moved focus — so a read on close would restore focus to
 * the viewer itself, which is gone. Kobalte restores focus to its trigger, and
 * this viewer has none: it is opened by an `onClick` on a thumbnail, not by a
 * `Dialog.Trigger`.
 */
export function createMediaViewer(): MediaViewerController {
  const [items, setItems] = createSignal<readonly MediaItem[]>([])
  const [index, setIndex] = createSignal(0)
  const [caption, setCaption] = createSignal<string | undefined>()
  const [isOpen, setOpen] = createSignal(false)
  let opener: HTMLElement | null = null

  const close = () => {
    setOpen(false)
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    opener = null
  }

  return {
    open: (next, at, label) => {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setItems(next)
      setIndex(at)
      setCaption(label)
      setOpen(true)
    },
    view: (
      <Show when={isOpen()}>
        <MediaViewer
          items={items()}
          index={index()}
          caption={caption()}
          onIndex={setIndex}
          onClose={close}
        />
      </Show>
    ),
  }
}