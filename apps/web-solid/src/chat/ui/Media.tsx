import { For, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { MediaItem } from "../../lib/types"
import { Play } from "lucide-solid"
import { RectPart, albumLayout, singleMediaBox, type AlbumLayout, type AlbumRect } from "../lib/album"
import { mediaThumbnail } from "../lib/media"

/**
 * A message's media: one fitted box, or an album grid.
 *
 * The split is tweb's. A single photo goes through `setAttachmentSize`'s clamp
 * ladder and lands in a fitted box — natural size when it is smaller than the
 * box, letterboxed when it is larger, widened when a caption would otherwise
 * be squeezed to nothing. Two or more go through the album layouter, whose
 * geometry is a straight port and which knows nothing about the DOM. Both are
 * asked for their size HERE, before the bytes land, so a decoding picture
 * cannot move the scroll anchor of every row beneath it.
 *
 * Nothing in this file draws a radius of its own beyond the album's outer
 * corners. The media sits flush inside `BubbleContent`, which already clips
 * with `rounded-bubble overflow-hidden`, so the bubble's own corners are the
 * media's corners — and the seam where the media meets a caption below it
 * stays square, which is what makes the two read as one surface.
 *
 * A video is shown as its poster frame with a duration badge, never as an
 * inline player. Playing it is the viewer's job: an inline `<video>` would put
 * a second set of chrome inside the bubble and a second scroll target inside
 * the transcript, and Telegram opens the viewer on a tap for the same reason.
 */

/** The 1px gap tweb leaves between album cells, and the album's own spacing. */
const ALBUM_SPACING = 1

/**
 * One album cell, positioned in percentages of the album box.
 *
 * Percentages rather than the layouter's own pixels, so the box can be capped
 * to `100%` on a narrow viewport and the cells follow it down instead of
 * overflowing the bubble. The layouter's px arithmetic is what decides the
 * SHAPE; the percentage conversion is what makes that shape resolution-
 * independent.
 *
 * The four corner radii are the ones the cell contributes to the album's
 * outline, and only those. An interior corner stays square: rounding it would
 * pull the cell away from its neighbour and open a gap that is not in the
 * layout. Each outline corner is the bubble's radius less the 1px spacing,
 * which is tweb's own `calc(var(--border-*-radius) - 1px)` and is what keeps
 * the gap visible as the corner turns.
 */
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

/** `m:ss`, the shape every chat client uses for a clip's length. */
function durationLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

/**
 * A clip's frame. The play mark is only drawn when the clip is the message's
 * whole media: in an album a cell is a couple of hundred pixels wide at most,
 * and a glyph in the middle of every cell reads as clutter rather than as
 * information. The duration badge is the mark an album cell gets.
 */
function MediaFrame(props: { item: MediaItem; solo: boolean }): JSX.Element {
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
        <Show when={props.solo}>
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

const CELL_CLASS = "absolute cursor-zoom-in overflow-hidden border-none bg-[var(--input-bg)] p-0"

export function MessageMedia(props: {
  items: readonly MediaItem[]
  /**
   * Whether the message also carries caption text. A lone item whose caption
   * would be squeezed below the text column's 320px is widened to it, which is
   * tweb's `EXPAND_TEXT_WIDTH` rung — and the same flag has to reach
   * `estimateRowHeight`, or the row reserves the wrong box.
   */
  hasText: boolean
  /** Opens the viewer at this item's index. */
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

  return (
    <Show
      when={props.items.length === 1}
      fallback={
        <div
          class={cn("relative block", props.class)}
          data-component="chat-media"
          data-count={props.items.length}
          style={{
            width: `min(${layout().width}px, 100%)`,
            "aspect-ratio": `${layout().width} / ${layout().height}`,
          }}
        >
          <For each={layout().items}>
            {(rect, index) => (
              <button
                type="button"
                class={CELL_CLASS}
                style={cellStyle(rect, layout())}
                data-component="chat-media-cell"
                aria-label={`Open ${props.items[index()].alt}`}
                onClick={() => props.onOpen(index())}
              >
                <MediaFrame item={props.items[index()]} solo={false} />
              </button>
            )}
          </For>
        </div>
      }
    >
      <button
        type="button"
        class={cn(
          "relative block cursor-zoom-in overflow-hidden border-none bg-[var(--input-bg)] p-0",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]",
          props.class,
        )}
        data-component="chat-media"
        data-count={1}
        style={{
          width: `min(${singleBox().width}px, 100%)`,
          "aspect-ratio": `${singleBox().width} / ${singleBox().height}`,
        }}
        aria-label={`Open ${props.items[0].alt}`}
        onClick={() => props.onOpen(0)}
      >
        <MediaFrame item={props.items[0]} solo />
      </button>
    </Show>
  )
}
