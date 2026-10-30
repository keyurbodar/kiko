import { createEffect, createSignal, For, Show } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, ResetIcon, CheckIcon } from "@kiko/ui/icons"
import { formatBytes } from "../../chat/info/format"
import { fileType } from "../../files/type"
import { TypeIcon } from "../../files/type-icon"
import { middleTruncate } from "../rich/nodes"
import { progressLabel, progressShare, retryUpload, uploadState, type UploadState } from "../uploads"
import { PASTED_TEXT, TilePreview, tileBadge, tileLook, type TileLook } from "./preview"
import type { PromptInputV2Attachment } from "./types"

export type Rejected = { id: string; name: string; reason: string }

const TILE_DRAG = "application/x-kiko-tray-tile"

function spoken(part: PromptInputV2Attachment, upload: UploadState | undefined): string {
  if (upload?.status === "uploading") return `${part.filename}, uploading ${progressLabel(upload.loaded, upload.total)}`
  if (upload?.status === "failed") return `${part.filename}, upload failed. ${upload.reason}`
  return `${part.filename}, ${formatBytes(part.size)}`
}

function Foot(props: { part: PromptInputV2Attachment; upload: UploadState | undefined; named: boolean }) {
  return (
    <span class="tray-foot">
      <Show
        when={props.upload?.status === "uploading" && props.upload}
        fallback={
          <Show
            when={props.upload?.status === "failed"}
            fallback={
              <>
                <span class="tray-badge">{tileBadge(props.part)}</span>
                <span class="tray-aside">
                  <Show when={props.named}>
                    <span class="tray-aside-name">{props.part.filename}</span>
                  </Show>
                  <span class="tray-aside-size">{formatBytes(props.part.size)}</span>
                </span>
              </>
            }
          >
            <span class="tray-failed">
              Failed
              <span class="tray-retry" data-action="retry-upload">
                Retry
              </span>
            </span>
          </Show>
        }
      >
        {(up) => <span class="tray-bytes">{progressLabel(up().loaded, up().total)}</span>}
      </Show>
    </span>
  )
}

function Tile(props: {
  part: PromptInputV2Attachment
  index: number
  onOpen: () => void
  onRemove: () => void
  onExpand: () => void
  onMove: (id: string, to: number) => void
}) {
  const upload = () => uploadState(props.part.id)
  const [leaving, setLeaving] = createSignal(false)
  const [landed, setLanded] = createSignal(false)
  let uploaded = false
  createEffect(() => {
    const status = upload()?.status
    if (status === "uploading") {
      uploaded = true
      return
    }
    if (status !== "ready" || !uploaded) return
    uploaded = false
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    setLanded(true)
  })
  const [dragging, setDragging] = createSignal(false)
  const [broken, setBroken] = createSignal(false)
  const look = (): TileLook => (broken() ? "type" : tileLook(props.part))
  const pictured = () => look() === "image" || look() === "video"
  const pasted = () => props.part.filename === PASTED_TEXT
  const share = () => {
    const u = upload()
    return u?.status === "uploading" ? progressShare(u.loaded, u.total) : 1
  }
  const remove = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return props.onRemove()
    setLeaving(true)
  }
  const open = () => {
    if (upload()?.status === "failed") return retryUpload(props.part.id)
    if (look() === "image") return props.onOpen()
    if (pasted()) props.onExpand()
  }
  return (
    <div
      class="tray-tile"
      data-component={look() === "image" ? "composer-attachment" : "composer-file"}
      data-id={props.part.id}
      data-kind={look() === "image" ? "image" : pasted() ? "pasted" : "file"}
      data-look={look()}
      data-state={upload()?.status}
      data-leaving={leaving() ? "" : undefined}
      data-dragging={dragging() ? "" : undefined}
      style={{ "--upload-share": share() }}
      draggable={true}
      onDragStart={(event) => {
        event.dataTransfer?.setData(TILE_DRAG, props.part.id)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes(TILE_DRAG)) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onDrop={(event) => {
        const id = event.dataTransfer?.getData(TILE_DRAG)
        if (!id) return
        event.preventDefault()
        event.stopPropagation()
        props.onMove(id, props.index)
      }}
      onAnimationEnd={(event) => {
        if (event.animationName === "tray-tile-out") props.onRemove()
      }}
    >
      <button
        type="button"
        class="tray-tile-open"
        title={props.part.filename}
        aria-label={spoken(props.part, upload())}
        data-action={pasted() ? "expand-pasted" : undefined}
        onClick={open}
      >
        <span class="tray-body">
          <TilePreview part={props.part} look={look()} onBroken={() => setBroken(true)} />
        </span>
        <Show when={upload()?.status === "failed" && pictured()}>
          <span class="tray-veil" data-tone="bad">
            <RemixIcon icon={ResetIcon} size={16} />
          </span>
        </Show>
        <Foot part={props.part} upload={upload()} named={look() !== "type" && !pasted()} />
        <Show when={upload()?.status === "uploading"}>
          <span class="tray-fill" aria-hidden="true" />
        </Show>
        <Show when={landed()}>
          <span class="tray-done" aria-hidden="true" onAnimationEnd={() => setLanded(false)}>
            <RemixIcon icon={CheckIcon} size={18} />
          </span>
        </Show>
      </button>
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
    <div class="tray-tile" data-kind="file" data-look="type" data-state="rejected" data-component="composer-rejected">
      <span class="tray-tile-open" title={`${props.item.name}: ${props.item.reason}`}>
        <span class="tray-body">
          <span class="tray-face">
            <TypeIcon type={fileType({ name: props.item.name, type: "" })} size={24} />
            <span class="tray-face-name">{middleTruncate(props.item.name, 44)}</span>
          </span>
        </span>
        <span class="tray-foot">
          <span class="tray-failed">{props.item.reason}</span>
        </span>
      </span>
      <button type="button" class="tray-remove" aria-label={`Dismiss ${props.item.name}`} onClick={props.onDismiss}>
        <RemixIcon icon={CloseIcon} size={12} />
      </button>
    </div>
  )
}

export function Tray(props: {
  attachments: PromptInputV2Attachment[]
  rejected: Rejected[]
  onOpen: (part: PromptInputV2Attachment) => void
  onRemove: (part: PromptInputV2Attachment) => void
  onExpand: (part: PromptInputV2Attachment) => void
  onMove: (id: string, to: number) => void
  onDismiss: (id: string) => void
}) {
  return (
    <div class="composer-shelf" data-component="prompt-input-v2-attachments">
      <For each={props.attachments}>
        {(part, index) => (
          <Tile
            part={part}
            index={index()}
            onOpen={() => props.onOpen(part)}
            onRemove={() => props.onRemove(part)}
            onExpand={() => props.onExpand(part)}
            onMove={props.onMove}
          />
        )}
      </For>
      <For each={props.rejected}>
        {(item) => <RefusedTile item={item} onDismiss={() => props.onDismiss(item.id)} />}
      </For>
    </div>
  )
}
