import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  FolderOpenIcon,
  type Glyph,
} from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Show, createSignal, createUniqueId, onCleanup, onMount, type JSX } from "solid-js"
import { wrapIndex } from "../../lib/attachments"
import { room } from "../../state/room"
import { openFile } from "../side/surfaces"
import "./image-dialog.css"
import type { DialogImage } from "./chat-images"
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

const TOOL =
  "grid size-8 cursor-pointer place-items-center rounded-control text-fg2 transition-[background-color,color,transform] duration-(--dur-hover) ease-kiko hover:bg-hover hover:text-fg active:scale-[0.94] outline-none"

const DONE_MS = 1200
const READOUT_MS = 1000

async function pngOf(src: string): Promise<Blob> {
  const blob = await (await fetch(src)).blob()
  if (blob.type === "image/png") return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0)
  return canvas.convertToBlob({ type: "image/png" })
}

function Tool(props: { label: string; icon: Glyph; onClick?: () => void; children?: JSX.Element }) {
  return (
    <TooltipV2 placement="bottom" openDelay={500} value={props.label}>
      {props.children ?? (
        <button type="button" class={TOOL} aria-label={props.label} onClick={() => props.onClick?.()}>
          <RemixIcon icon={props.icon} size={16} />
        </button>
      )}
    </TooltipV2>
  )
}

function OpenInFiles(props: { path: string; onClose: () => void }) {
  const open = () => {
    const chatId = room.activeId()
    if (!chatId) return
    openFile(chatId, props.path)
    props.onClose()
  }
  return <Tool label="Open in Files" icon={FolderOpenIcon} onClick={open} />
}

function Toolbar(props: { image: DialogImage | undefined; failed: boolean; onClose: () => void }) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = async () => {
    const image = props.image
    if (!image) return
    const blob = await pngOf(image.src)
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    setCopied(true)
    clearTimeout(timer)
    timer = setTimeout(() => setCopied(false), DONE_MS)
  }
  return (
    <div
      data-component="image-dialog-toolbar"
      class="absolute top-0 right-0 z-30 flex items-center gap-0.5 rounded-pop bg-raise p-1 shadow-[var(--float-shadow)]"
    >
      <Show when={room.activeId() && props.image?.path} keyed>
        {(path) => <OpenInFiles path={path} onClose={props.onClose} />}
      </Show>
      <Show when={props.image && !props.failed}>
        <Tool label="Download" icon={DownloadIcon}>
          <a
            class={TOOL}
            href={props.image!.src}
            download={props.image!.name}
            aria-label="Download"
            data-action="download-image"
          >
            <RemixIcon icon={DownloadIcon} size={16} />
          </a>
        </Tool>
        <Show when={typeof ClipboardItem !== "undefined" && !props.image?.video}>
          <Tool
            label={copied() ? "Copied" : "Copy image"}
            icon={copied() ? CheckIcon : CopyIcon}
            onClick={() => void copy()}
          />
        </Show>
      </Show>
      <Tool label="Close image preview" icon={CloseIcon} onClick={props.onClose} />
    </div>
  )
}

export default function ImageDialog(props: { images: readonly DialogImage[]; index: number; onClose: () => void }) {
  const [offset, setOffset] = createSignal(0)
  const [failed, setFailed] = createSignal<string | null>(null)
  const [scale, setScale] = createSignal<number | null>(null)
  const [readout, setReadout] = createSignal(false)
  let readoutTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(readoutTimer))
  const zoomed = (next: number) => {
    setScale(next)
    setReadout(true)
    clearTimeout(readoutTimer)
    readoutTimer = setTimeout(() => setReadout(false), READOUT_MS)
  }
  const count = () => props.images.length
  const index = () => wrapIndex(props.index + offset(), count())
  const item = () => props.images[index()]
  const step = (by: -1 | 1) => setOffset((n) => n + by)
  let pan: ((key: string) => boolean) | undefined

  return (
    <ModalV2 open onOpenChange={(open: boolean) => !open && props.onClose()}>
      <ModalV2.Portal>
        <ModalV2.Overlay class="bg-black/80!" />
        <ModalV2.Content
          class="h-[92vh] w-[92vw] items-center justify-center"
          data-lightbox=""
          onOpenAutoFocus={(event: Event) => {
            const picture = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              '[data-component="image-dialog-viewport"]',
            )
            if (!picture) return
            event.preventDefault()
            picture.focus()
          }}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLVideoElement) return
            if (pan?.(event.key)) return event.preventDefault()
            if (count() < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
            event.preventDefault()
            step(event.key === "ArrowLeft" ? -1 : 1)
          }}
          onClick={(event: MouseEvent) => {
            if (event.target === event.currentTarget) props.onClose()
          }}
        >
          <ModalV2.Title class="sr-only">{item()?.video ? "Video preview" : "Image preview"}</ModalV2.Title>
          <Toolbar image={item()} failed={failed() === item()?.src} onClose={props.onClose} />
          <Show when={count() > 1}>
            <button type="button" class={`${NAV} left-0`} aria-label="Previous" onClick={() => step(-1)}>
              <RemixIcon icon={ChevronLeftIcon} class="size-5" />
            </button>
          </Show>
          <Show when={item()} keyed>
            {(image) => (
              <div
                class="relative z-10 flex max-w-[calc(92vw-96px)] flex-col items-center"
                data-component="image-dialog"
              >
                <Show
                  when={failed() !== image.src}
                  fallback={
                    <div
                      role="alert"
                      class="flex h-48 w-[min(92vw,32rem)] flex-col items-center justify-center gap-1 rounded-card bg-panel p-6 text-center"
                    >
                      <p class="type-row text-fg">{image.video ? "Video unavailable" : "Image unavailable"}</p>
                      <p class="type-label text-fg3">The file may have been moved or deleted.</p>
                    </div>
                  }
                >
                  <Show
                    when={image.video}
                    fallback={
                      <ZoomableImage
                        src={image.src}
                        name={image.name}
                        onError={() => setFailed(image.src)}
                        panRef={(fn) => (pan = fn)}
                        onZoom={zoomed}
                      />
                    }
                  >
                    <video
                      src={image.src}
                      controls
                      autoplay
                      playsinline
                      aria-label={image.name}
                      class="max-h-[80vh] max-w-[calc(92vw-96px)] rounded-tile shadow-[var(--float-shadow)] outline-none max-sm:max-w-[92vw]"
                      onError={() => setFailed(image.src)}
                    />
                  </Show>
                </Show>
                <p
                  class="mt-2 max-w-full truncate text-hint text-white/80"
                  aria-live="polite"
                  data-component="image-dialog-caption"
                >
                  {image.name}
                  {count() > 1 ? ` (${index() + 1}/${count()})` : ""}
                </p>
                <p
                  class="h-4 type-hint text-white/70"
                  classList={{ "opacity-0": !readout() }}
                  aria-hidden="true"
                  data-component="image-dialog-zoom"
                >
                  {scale() === null ? "" : `${Math.round(scale()! * 100)}%`}
                </p>
              </div>
            )}
          </Show>
          <Show when={count() > 1}>
            <button type="button" class={`${NAV} right-0`} aria-label="Next" onClick={() => step(1)}>
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
  onError: () => void
  panRef: (pan: (key: string) => boolean) => void
  onZoom: (scale: number) => void
}) {
  let viewport!: HTMLDivElement
  const hint = createUniqueId()
  const [natural, setNatural] = createSignal({ width: 0, height: 0 })
  const [window_, setWindow] = createSignal({ width: window.innerWidth, height: window.innerHeight })
  const [zoom, setZoom] = createSignal(1)
  const [dragging, setDragging] = createSignal(false)
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
    props.onZoom(fit() * target)
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
    viewport.focus({ preventScroll: true })
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
        class="max-w-[calc(92vw-96px)] overflow-auto overscroll-contain rounded-tile shadow-[var(--float-shadow)] outline-none max-sm:max-w-[92vw]"
        style={{
          width: width() ? `${width()}px` : undefined,
          height: height() ? `${height()}px` : undefined,
          "max-height": `${maxHeight(window_())}px`,
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
          }}
          onError={props.onError}
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
