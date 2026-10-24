import { createResource, createSignal, For, Show, type JSX } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, ResetIcon } from "@kiko/ui/icons"
import { formatBytes } from "../../chat/info/format"
import { isImage } from "../../lib/attachments"
import { fileType } from "../../files/type"
import { TypeIcon } from "../../files/type-icon"
import { retryUpload, uploadState } from "../uploads"
import type { PromptInputV2Attachment } from "./types"

export type Rejected = { id: string; name: string; reason: string }

export const PASTED_TEXT = "Pasted text.txt"

const SHOWN = 5
const RING = 2 * Math.PI * 14
const TILE_DRAG = "application/x-kiko-tray-tile"

const pictured = (part: PromptInputV2Attachment) => isImage({ name: part.filename, type: part.mime })

function typeLabel(part: PromptInputV2Attachment): string {
  const ext = /\.([^./]+)$/.exec(part.filename)?.[1]
  return ext ? ext.toUpperCase() : "File"
}

function Ring(props: { progress: number }) {
  return (
    <svg class="tray-ring" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" />
      <circle
        cx="16"
        cy="16"
        r="14"
        data-fill=""
        style={{ "stroke-dasharray": `${RING}`, "stroke-dashoffset": `${RING * (1 - Math.max(0.04, props.progress))}` }}
      />
    </svg>
  )
}

function Tip(props: { children: JSX.Element }) {
  return (
    <span class="tray-tip" role="tooltip">
      {props.children}
    </span>
  )
}

function pastedStats(text: string): string {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const lines = text.split("\n").length
  return `${words.toLocaleString("en-US")} words, ${lines.toLocaleString("en-US")} lines`
}

function TileBody(props: { part: PromptInputV2Attachment; onExpand: () => void }) {
  const upload = () => uploadState(props.part.id)
  const pasted = () => props.part.filename === PASTED_TEXT
  const [text] = createResource(
    () => (pasted() ? props.part.blob.url : null),
    (url) => fetch(url).then((res) => res.text()),
  )
  const meta = () => {
    const u = upload()
    if (u?.status === "failed") return null
    if (pasted()) return text() === undefined ? "Text" : pastedStats(text()!)
    return `${typeLabel(props.part)}, ${formatBytes(props.part.size)}`
  }
  return (
    <>
      <Show
        when={pasted()}
        fallback={<TypeIcon type={fileType({ name: props.part.filename, type: props.part.mime })} size={26} />}
      >
        <span class="tray-text-glyph" aria-hidden="true">
          T
        </span>
      </Show>
      <span class="tray-file-text">
        <span class="tray-file-name">{pasted() ? "Pasted text" : props.part.filename}</span>
        <Show
          when={upload()?.status === "uploading" && !pasted()}
          fallback={
            <Show
              when={meta()}
              fallback={
                <span class="tray-file-meta" data-tone="bad">
                  Failed
                  <button
                    type="button"
                    class="tray-inline-action"
                    data-action="retry-upload"
                    onClick={(event) => {
                      event.stopPropagation()
                      retryUpload(props.part.id)
                    }}
                  >
                    Retry
                  </button>
                </span>
              }
            >
              <span class="tray-file-meta">
                {meta()}
                <Show when={pasted()}>
                  <button
                    type="button"
                    class="tray-inline-action"
                    data-action="expand-pasted"
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onExpand()
                    }}
                  >
                    Expand
                  </button>
                </Show>
              </span>
            </Show>
          }
        >
          <span class="tray-bar" aria-hidden="true">
            <i style={{ width: `${Math.round(((upload() as { progress: number }).progress || 0.04) * 100)}%` }} />
          </span>
        </Show>
      </span>
      <Show when={pasted() && text()}>
        <Tip>
          <span class="tray-tip-lines">{text()!.split("\n").slice(0, 6).join("\n")}</span>
        </Tip>
      </Show>
    </>
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
  const [dragging, setDragging] = createSignal(false)
  const image = () => pictured(props.part)
  const remove = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return props.onRemove()
    setLeaving(true)
  }
  return (
    <div
      class="tray-tile"
      data-component={image() ? "composer-attachment" : "composer-file"}
      data-id={props.part.id}
      data-kind={image() ? "image" : props.part.filename === PASTED_TEXT ? "pasted" : "file"}
      data-state={upload()?.status}
      data-leaving={leaving() ? "" : undefined}
      data-dragging={dragging() ? "" : undefined}
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
        aria-label={
          upload()?.status === "failed" ? `Retry upload for ${props.part.filename}` : `Open ${props.part.filename}`
        }
        onClick={() => {
          if (upload()?.status === "failed") retryUpload(props.part.id)
          else if (image()) props.onOpen()
        }}
      >
        <Show when={image()} fallback={<TileBody part={props.part} onExpand={props.onExpand} />}>
          <img src={props.part.blob.url} alt={props.part.filename} draggable={false} />
          <Show when={upload()?.status === "uploading"}>
            <span class="tray-veil">
              <Ring progress={(upload() as { progress: number }).progress} />
            </span>
          </Show>
          <Show when={upload()?.status === "failed"}>
            <span class="tray-veil" data-tone="bad">
              <RemixIcon icon={ResetIcon} size={18} />
            </span>
          </Show>
        </Show>
      </button>
      <Show when={props.part.filename !== PASTED_TEXT}>
        <Tip>
          {props.part.filename}
          <span class="tray-tip-size">
            {upload()?.status === "failed" ? (upload() as { reason: string }).reason : formatBytes(props.part.size)}
          </span>
        </Tip>
      </Show>
      <button
        type="button"
        class="tray-remove"
        aria-label={`Remove ${props.part.filename}`}
        data-action="remove-attachment"
        onClick={remove}
      >
        <RemixIcon icon={CloseIcon} size={11} />
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
  const [all, setAll] = createSignal(false)
  const total = () => props.attachments.length + props.rejected.length
  const folded = () => !all() && total() > SHOWN
  const visible = () => (folded() ? SHOWN - 1 : total())
  const shown = () => props.attachments.slice(0, visible())
  const refused = () => props.rejected.slice(0, Math.max(0, visible() - props.attachments.length))
  return (
    <div class="composer-shelf" data-component="prompt-input-v2-attachments">
      <For each={shown()}>
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
      <For each={refused()}>
        {(item) => (
          <div class="tray-tile" data-kind="file" data-state="rejected" data-component="composer-rejected">
            <TypeIcon type={fileType({ name: item.name, type: "" })} size={26} />
            <span class="tray-file-text">
              <span class="tray-file-name">{item.name}</span>
              <span class="tray-file-meta" data-tone="bad">
                {item.reason}
              </span>
            </span>
            <button
              type="button"
              class="tray-remove"
              aria-label={`Dismiss ${item.name}`}
              onClick={() => props.onDismiss(item.id)}
            >
              <RemixIcon icon={CloseIcon} size={11} />
            </button>
          </div>
        )}
      </For>
      <Show when={folded()}>
        <button
          type="button"
          class="tray-tile tray-more"
          data-kind="image"
          aria-label={`Show all ${total()} files`}
          onClick={() => setAll(true)}
        >
          +{total() - (SHOWN - 1)}
        </button>
      </Show>
    </div>
  )
}
