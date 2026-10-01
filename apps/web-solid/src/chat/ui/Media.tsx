import { createEffect, For, onCleanup, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { MediaItem } from "../../lib/types"
import { Play } from "lucide-solid"
import { RectPart, albumLayout, singleMediaBox, type AlbumLayout, type AlbumRect } from "../lib/album"
import { mediaThumbnail } from "../lib/media"

const ALBUM_SPACING = 1

const CELL_BASE = "cursor-zoom-in overflow-hidden border-none bg-[var(--input-bg)] p-0"
const ALBUM_CELL = `absolute ${CELL_BASE}`
const GRID_CELL = `relative block aspect-[4/3] rounded-lg ${CELL_BASE}`

function cellStyle(rect: AlbumRect, layout: AlbumLayout): JSX.CSSProperties {
  const radius = `calc(var(--radius-bubble) - ${ALBUM_SPACING}px)`
  const atStart = (rect.sides & RectPart.Left) !== 0
  const atEnd = (rect.sides & RectPart.Right) !== 0
  const atTop = (rect.sides & RectPart.Top) !== 0
  const atBottom = (rect.sides & RectPart.Bottom) !== 0
  return {
    left: `${(rect.x / layout.width) * 100}%`,
    top: `${(rect.y / layout.height) * 100}%`,
    width: `${(rect.width / layout.width) * 100}%`,
    height: `${(rect.height / layout.height) * 100}%`,
    "border-start-start-radius": atStart && atTop ? radius : "0",
    "border-start-end-radius": atEnd && atTop ? radius : "0",
    "border-end-end-radius": atEnd && atBottom ? radius : "0",
    "border-end-start-radius": atStart && atBottom ? radius : "0",
  }
}

function durationLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

function MediaFrame(props: { item: MediaItem; playMark: boolean }): JSX.Element {
  return (
    <>
      <img
        class="block size-full object-cover"
        src={mediaThumbnail(props.item)}
        alt={props.item.alt}
        width={props.item.width}
        height={props.item.height}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
      <Show when={props.item.kind === "video"}>
        <Show when={props.playMark}>
          <span class="pointer-events-none absolute inset-0 grid place-items-center">
            <span class="grid size-9 place-items-center rounded-full bg-black/45 text-white">
              <Play class="size-4 translate-x-px" fill="currentColor" stroke-width={0} />
            </span>
          </span>
        </Show>
        <Show when={props.item.duration !== undefined}>
          <span
            class="pointer-events-none absolute end-1 bottom-1 rounded-full bg-black/55 px-1.5 text-[11px] leading-[1.35] text-white"
            data-component="chat-media-duration"
          >
            {durationLabel(props.item.duration!)}
          </span>
        </Show>
      </Show>
    </>
  )
}

function reportFittedWidth(
  reportWidth: (width: number | undefined) => void,
  read: () => number,
): void {
  createEffect(() => reportWidth(read()))
  onCleanup(() => reportWidth(undefined))
}

function AlbumMedia(props: {
  items: readonly MediaItem[]
  hasText: boolean
  reportWidth: (width: number | undefined) => void
  onOpen: (index: number) => void
  class?: string
}): JSX.Element {
  const layout = () =>
    albumLayout(props.items.map((item) => ({ w: item.width, h: item.height })))

  const singleBox = () => {
    const only = props.items[0]
    return singleMediaBox(
      { w: only.width, h: only.height },
      { hasText: props.hasText, isVideo: only.kind === "video" },
    )
  }

  const boxWidth = () => (props.items.length === 1 ? singleBox().width : layout().width)
  reportFittedWidth(props.reportWidth, boxWidth)

  return (
    <Show
      when={props.items.length === 1}
      fallback={
        <div
          class={cn("relative block", props.class)}
          data-component="chat-media"
          data-count={props.items.length}
          style={{
            width: `${layout().width}px`,
            "max-width": "100%",
            "aspect-ratio": `${layout().width} / ${layout().height}`,
          }}
        >
          <For each={layout().items}>
            {(rect, index) => (
              <button
                type="button"
                class={ALBUM_CELL}
                style={cellStyle(rect, layout())}
                data-component="chat-media-cell"
                aria-label={`Open ${props.items[index()].alt}`}
                onClick={() => props.onOpen(index())}
              >
                <MediaFrame item={props.items[index()]} playMark={false} />
              </button>
            )}
          </For>
        </div>
      }
    >
      <button
        type="button"
        class={cn(
          "relative block overflow-hidden",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]",
          CELL_BASE,
          props.class,
        )}
        data-component="chat-media"
        data-count={props.items.length}
        style={{
          width: `${singleBox().width}px`,
          "max-width": "100%",
          "aspect-ratio": `${singleBox().width} / ${singleBox().height}`,
        }}
        aria-label={`Open ${props.items[0].alt}`}
        onClick={() => props.onOpen(0)}
      >
        <MediaFrame item={props.items[0]} playMark />
      </button>
    </Show>
  )
}

function GridMedia(props: {
  items: readonly MediaItem[]
  onOpen: (index: number) => void
  class?: string
}): JSX.Element {
  return (
    <div class={cn("mb-2", props.class)}>
      <div
        class="grid w-[210px] max-w-[210px] grid-cols-2 gap-2"
        data-component="chat-media"
        data-count={props.items.length}
      >
        <For each={props.items}>
          {(item, index) => (
            <button
              type="button"
              class={GRID_CELL}
              data-component="chat-media-cell"
              aria-label={`Open ${item.alt}`}
              onClick={() => props.onOpen(index())}
            >
              <MediaFrame item={item} playMark={false} />
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

export function MessageMedia(props: {
  items: readonly MediaItem[]
  hasText: boolean
  side: "user" | "bot"
  fittedWidth?: (width: number | undefined) => void
  onOpen: (index: number) => void
  class?: string
}): JSX.Element {
  const reportWidth = () => props.fittedWidth ?? (() => undefined)
  return (
    <Show
      when={props.side === "bot"}
      fallback={
        <GridMedia
          items={props.items}
          onOpen={props.onOpen}
          class={props.class}
        />
      }
    >
      <AlbumMedia
        items={props.items}
        hasText={props.hasText}
        reportWidth={reportWidth()}
        onOpen={props.onOpen}
        class={props.class}
      />
    </Show>
  )
}