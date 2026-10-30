import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, PlusIcon, ResetIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { formatBytes } from "../../chat/info/format"
import { fileType } from "../../files/type"
import { TypeIcon } from "../../files/type-icon"
import { middleTruncate } from "../rich/nodes"
import { progressShare, retryUpload, uploadState } from "../uploads"
import { PASTED_TEXT, TileThumb, tileBadge, tileLook } from "./preview"
import type { PromptInputV2Attachment } from "./types"

export type Rejected = { id: string; name: string; reason: string }

const TILES_BEFORE_MORE = 4
const TILES_MAX = 5
const TOOLTIP_DELAY = 300

function spoken(part: PromptInputV2Attachment): string {
  const upload = uploadState(part.id)
  if (upload?.status === "uploading") return `${part.filename}, uploading`
  if (upload?.status === "failed") return `${part.filename}, upload failed. ${upload.reason}`
  return `${part.filename}, ${formatBytes(part.size)}`
}

function Tip(props: { part: PromptInputV2Attachment }) {
  return (
    <span class="tray-tip">
      <span class="tray-tip-name">{props.part.filename}</span>
      <span class="tray-tip-size">{formatBytes(props.part.size)}</span>
    </span>
  )
}

function FileFace(props: { name: string; mime: string; size?: number; failed?: boolean; note?: string }) {
  const type = () => fileType({ name: props.name, type: props.mime })
  return (
    <>
      <span class="tray-face">
        <TypeIcon type={type()} size={26} />
      </span>
      <span class="tray-text">
        <span class="tray-name">{middleTruncate(props.name, 40)}</span>
        <Show
          when={props.failed || props.note}
          fallback={
            <span class="tray-meta">
              {tileBadge({ filename: props.name, mime: props.mime })}
              {" · "}
              {formatBytes(props.size ?? 0)}
            </span>
          }
        >
          <Show
            when={props.failed}
            fallback={
              <span class="tray-failed" title={props.note}>
                {props.note}
              </span>
            }
          >
            <span class="tray-failed">
              Failed
              <span class="tray-retry" data-action="retry-upload">
                Retry
              </span>
            </span>
          </Show>
        </Show>
      </span>
    </>
  )
}

function Tile(props: {
  part: PromptInputV2Attachment
  onOpen: () => void
  onRemove: () => void
  onExpand: () => void
}) {
  const upload = () => uploadState(props.part.id)
  const look = () => tileLook(props.part)
  const pictured = () => look() !== "type"
  const pasted = () => props.part.filename === PASTED_TEXT
  const failed = () => upload()?.status === "failed"
  const uploading = () => upload()?.status === "uploading"
  const share = () => {
    const state = upload()
    return state?.status === "uploading" ? progressShare(state.loaded, state.total) : 1
  }
  const [leaving, setLeaving] = createSignal(false)
  const open = () => {
    if (failed()) return retryUpload(props.part.id)
    if (look() === "image") return props.onOpen()
    if (pasted()) props.onExpand()
  }
  const remove = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return props.onRemove()
    setLeaving(true)
  }
  return (
    <div
      class="tray-tile"
      data-leaving={leaving() ? "" : undefined}
      onAnimationEnd={(event) => {
        if (event.animationName === "tray-tile-out") props.onRemove()
      }}
      data-component={pictured() ? "composer-attachment" : "composer-file"}
      data-id={props.part.id}
      data-look={look()}
      data-state={upload()?.status}
      style={{ "--upload-share": share() }}
    >
      <TooltipV2 placement="top" openDelay={TOOLTIP_DELAY} value={<Tip part={props.part} />}>
        <button
          type="button"
          class="tray-tile-open"
          aria-label={spoken(props.part)}
          data-action={pasted() ? "expand-pasted" : undefined}
          onClick={open}
        >
          <Show
            when={pictured()}
            fallback={
              <FileFace name={props.part.filename} mime={props.part.mime} size={props.part.size} failed={failed()} />
            }
          >
            <TileThumb part={props.part} />
            <Show when={uploading()}>
              <span class="tray-ring" aria-hidden="true" />
            </Show>
            <Show when={failed()}>
              <span class="tray-veil" data-tone="bad">
                <RemixIcon icon={ResetIcon} size={16} />
              </span>
            </Show>
          </Show>
        </button>
      </TooltipV2>
      <button
        type="button"
        class="tray-remove"
        aria-label={`Remove ${props.part.filename}`}
        data-action="remove-attachment"
        onClick={remove}
      >
        <RemixIcon icon={CloseIcon} size={12} />
      </button>
    </div>
  )
}

function RefusedTile(props: { item: Rejected; onDismiss: () => void }) {
  return (
    <div class="tray-tile" data-look="type" data-state="rejected" data-component="composer-rejected">
      <span class="tray-tile-open" title={`${props.item.name}: ${props.item.reason}`}>
        <FileFace name={props.item.name} mime="" note={props.item.reason} />
      </span>
      <button type="button" class="tray-remove" aria-label={`Dismiss ${props.item.name}`} onClick={props.onDismiss}>
        <RemixIcon icon={CloseIcon} size={12} />
      </button>
    </div>
  )
}

function MoreTile(props: { count: number; onOpen: () => void }) {
  return (
    <button type="button" class="tray-tile tray-more" data-action="show-all-attachments" onClick={props.onOpen}>
      <RemixIcon icon={PlusIcon} size={12} />
      <span>+{props.count}</span>
    </button>
  )
}

export function Tray(props: {
  attachments: PromptInputV2Attachment[]
  rejected: Rejected[]
  onOpen: (part: PromptInputV2Attachment) => void
  onRemove: (part: PromptInputV2Attachment) => void
  onExpand: (part: PromptInputV2Attachment) => void
  onDismiss: (id: string) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const [fade, setFade] = createSignal({ start: false, end: false })
  let shelf!: HTMLDivElement
  const tiles = createMemo(() => {
    const all = props.attachments
    if (expanded() || all.length <= TILES_MAX) return { shown: all, more: 0 }
    return { shown: all.slice(0, TILES_BEFORE_MORE), more: all.length - TILES_BEFORE_MORE }
  })
  const syncFade = () => {
    if (!shelf) return
    const max = shelf.scrollWidth - shelf.clientWidth
    setFade({ start: shelf.scrollLeft > 1, end: max > 1 && shelf.scrollLeft < max - 1 })
  }
  onMount(() => {
    syncFade()
    const observer = new ResizeObserver(syncFade)
    observer.observe(shelf)
    shelf.addEventListener("scroll", syncFade, { passive: true })
    onCleanup(() => {
      observer.disconnect()
      shelf.removeEventListener("scroll", syncFade)
    })
  })
  return (
    <div
      ref={shelf}
      class="composer-shelf"
      data-component="prompt-input-v2-attachments"
      data-fade-start={fade().start ? "" : undefined}
      data-fade-end={fade().end ? "" : undefined}
    >
      <For each={tiles().shown}>
        {(part) => (
          <Tile
            part={part}
            onOpen={() => props.onOpen(part)}
            onRemove={() => props.onRemove(part)}
            onExpand={() => props.onExpand(part)}
          />
        )}
      </For>
      <Show when={tiles().more > 0}>
        <MoreTile count={tiles().more} onOpen={() => setExpanded(true)} />
      </Show>
      <For each={props.rejected}>
        {(item) => <RefusedTile item={item} onDismiss={() => props.onDismiss(item.id)} />}
      </For>
    </div>
  )
}
