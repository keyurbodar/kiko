import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { MediaItem } from "../../lib/types"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { PlayIcon } from "@kiko/ui/icons"
import { albumLayout, cornerRadii, singleMediaBox } from "../lib/album"
import { mediaThumbnail } from "../lib/media"

const ALBUM_SPACING = 2

const CELL_BASE =
  "cursor-zoom-in overflow-hidden border-none bg-tint p-0 focus-visible:-outline-offset-2"

/** Rounds only the corners a cell shares with the album's outline. */
function radiusClass(sides: number, hasText: boolean): string {
  const r = cornerRadii(sides, { bottom: hasText })
  return cn(
    r.startStart && "rounded-ss-bubble",
    r.startEnd && "rounded-se-bubble",
    r.endStart && "rounded-es-bubble",
    r.endEnd && "rounded-ee-bubble",
  )
}

function durationLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

/** The decoder loads with the first picture that has a sketch, not with the first paint. */
let decoder: Promise<typeof import("thumbhash")> | undefined
const [decoderReady, setDecoderReady] = createSignal(false)

/** The thumbhash as a tiny PNG, or undefined when there is none, it does not decode, or the decoder is still loading. */
function sketchOf(hash: string | undefined): string | undefined {
  if (!hash) return undefined
  if (!decoderReady()) {
    decoder ??= import("thumbhash").then((m) => {
      thumbHashToDataURL = m.thumbHashToDataURL
      setDecoderReady(true)
      return m
    })
    return undefined
  }
  try {
    return thumbHashToDataURL!(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)))
  } catch {
    return undefined
  }
}
let thumbHashToDataURL: ((hash: ArrayLike<number>) => string) | undefined

function MediaFrame(props: { item: MediaItem; playMark: boolean }): JSX.Element {
  // The sketch shows until the still has painted, then goes, so a transparent picture never shows it through.
  const [loaded, setLoaded] = createSignal(false)
  const sketch = createMemo(() => (loaded() ? undefined : sketchOf(props.item.thumbhash)))
  const still = () => mediaThumbnail(props.item)
  return (
    <>
      <Show
        when={still()}
        fallback={<span class="block size-full bg-cover bg-center" style={{ "background-image": sketch() ? `url(${sketch()})` : undefined }} />}
      >
        <img
          class="block size-full bg-cover bg-center object-cover"
          style={{ "background-image": sketch() ? `url(${sketch()})` : undefined }}
          src={still()}
          alt={props.item.alt}
          width={props.item.width}
          height={props.item.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
      </Show>
      <Show when={props.item.kind === "video"}>
        <Show when={props.playMark}>
          <span class="pointer-events-none absolute inset-0 grid place-items-center">
            <span class="grid size-14 place-items-center rounded-full bg-black/35 text-white">
              <HugeIcon icon={PlayIcon} class="size-6 translate-x-px" fill="currentColor" stroke-width={0} />
            </span>
          </span>
        </Show>
        <Show when={props.item.duration !== undefined}>
          <span
            class="pointer-events-none absolute start-[3px] top-[3px] h-[18px] rounded-full bg-black/35 px-1.5 text-[12px] leading-[18px] text-white"
            data-component="chat-media-duration"
          >
            {durationLabel(props.item.duration!)}
          </span>
        </Show>
      </Show>
    </>
  )
}

export function MessageMedia(props: {
  items: readonly MediaItem[]
  hasText: boolean
  onOpen: (index: number) => void
  fittedWidth?: (width: number | undefined) => void
  class?: string
}): JSX.Element {
  const single = () => props.items.length === 1
  const layout = () =>
    albumLayout(
      props.items.map((item) => ({ w: item.width, h: item.height })),
      { spacing: ALBUM_SPACING },
    )
  const singleBox = () =>
    singleMediaBox(
      { w: props.items[0].width, h: props.items[0].height },
      { hasText: props.hasText, isVideo: props.items[0].kind === "video" },
    )
  const box = () => (single() ? singleBox() : layout())

  createEffect(() => props.fittedWidth?.(box().width))
  onCleanup(() => props.fittedWidth?.(undefined))

  return (
    <div
      class={cn("relative block", props.class)}
      data-component="chat-media"
      data-count={props.items.length}
      style={{
        width: `${box().width}px`,
        "max-width": "100%",
        "aspect-ratio": `${box().width} / ${box().height}`,
      }}
    >
      <Show
        when={!single()}
        fallback={
          <button
            type="button"
            class={cn("relative block size-full", CELL_BASE)}
            data-component="chat-media-cell"
            aria-label={`Open ${props.items[0].alt}`}
            onClick={() => props.onOpen(0)}
          >
            <MediaFrame item={props.items[0]} playMark />
          </button>
        }
      >
        <For each={layout().items}>
          {(rect, index) => (
            <button
              type="button"
              class={cn("absolute", CELL_BASE, radiusClass(rect.sides, props.hasText))}
              style={{
                left: `${(rect.x / layout().width) * 100}%`,
                top: `${(rect.y / layout().height) * 100}%`,
                width: `${(rect.width / layout().width) * 100}%`,
                height: `${(rect.height / layout().height) * 100}%`,
              }}
              data-component="chat-media-cell"
              aria-label={`Open ${props.items[index()].alt}`}
              onClick={() => props.onOpen(index())}
            >
              <MediaFrame item={props.items[index()]} playMark={false} />
            </button>
          )}
        </For>
      </Show>
    </div>
  )
}
