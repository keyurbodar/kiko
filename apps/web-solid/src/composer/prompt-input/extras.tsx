import { For, Show } from "solid-js"
import { FolderIcon } from "lucide-solid"
import { Undo2Icon, XIcon } from "lucide-solid"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { isImage } from "../../lib/attachments"
import { EntryIcon } from "../../lib/EntryIcon"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { progressLabel, retryUpload, uploadState } from "../../sync/uploads"
import { middleTruncate } from "../rich/nodes"
import type { PromptInputV2Attachment, PromptInputV2Suggestion } from "./types"

const RING = 2 * Math.PI * 15

function RetryButton(props: { name: string; reason: string; onRetry: () => void }) {
  return (
    <TooltipV2 placement="top" value={props.reason}>
      <button
        type="button"
        class="composer-attachment-retry"
        aria-label={`Retry upload for ${props.name}`}
        data-action="retry-upload"
        onClick={(event) => {
          event.stopPropagation()
          props.onRetry()
        }}
      >
        <Undo2Icon size={12} />
      </button>
    </TooltipV2>
  )
}

/** Every attachment in one row above the text: a picture as a thumbnail, any other file as a card. */
export function PromptInputV2Attachments(props: {
  attachments: PromptInputV2Attachment[]
  onImageClick?: (attachment: PromptInputV2Attachment) => void
  onRemove: (attachment: PromptInputV2Attachment) => void
}) {
  return (
    <div data-component="prompt-input-v2-attachments" class="composer-attachments">
      <For each={props.attachments}>
        {(attachment) => {
          const upload = () => uploadState(attachment.id)
          const picture = isImage({ name: attachment.filename, type: attachment.mime })
          const progress = () => {
            const u = upload()
            return u?.status === "uploading" ? u.progress : null
          }
          return (
            <div
              class="composer-attachment"
              data-component="composer-attachment"
              data-image={picture ? "" : undefined}
              data-id={attachment.id}
              data-state={upload()?.status}
              title={failure(upload()) ?? attachment.filename}
            >
              <Show
                when={picture}
                fallback={
                  <div class="composer-attachment-file">
                    <EntryIcon path={attachment.filename} />
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate text-sm text-foreground">{middleTruncate(attachment.filename, 24)}</span>
                      <span class="truncate text-xs text-muted-foreground">
                        {progress() !== null ? progressLabel(progress()!) : upload()?.status === "failed" ? "Failed" : formatBytes(attachment.size)}
                      </span>
                    </span>
                  </div>
                }
              >
                <button type="button" class="composer-attachment-open" aria-label={`Preview ${attachment.filename}`} onClick={() => props.onImageClick?.(attachment)}>
                  <img src={attachment.blob.url} alt={attachment.filename} draggable={false} />
                </button>
                <Show when={progress() !== null}>
                  <svg class="composer-attachment-ring" viewBox="0 0 36 36" role="img" aria-label={progressLabel(progress()!)}>
                    <circle cx="18" cy="18" r="15" />
                    <circle cx="18" cy="18" r="15" stroke-dasharray={String(RING)} stroke-dashoffset={String(RING * (1 - progress()!))} />
                  </svg>
                </Show>
              </Show>
              <Show when={failure(upload())}>
                {(reason) => <RetryButton name={attachment.filename} reason={reason()} onRetry={() => retryUpload(attachment.id)} />}
              </Show>
              <button type="button" class="composer-attachment-remove" aria-label={`Remove ${attachment.filename}`} onClick={() => props.onRemove(attachment)}>
                <XIcon size={11} />
              </button>
            </div>
          )
        }}
      </For>
    </div>
  )
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function failure(upload: ReturnType<typeof uploadState>) {
  return upload?.status === "failed" ? upload.reason : null
}

export function PromptInputV2Popover(props: {
  emptyLabel: string
  items: PromptInputV2Suggestion[]
  activeID?: string
  search?: {
    value: string
    label: string
    placeholder: string
    onValueChange: (value: string) => void
    onKeyDown: (event: KeyboardEvent) => void
  }
  onActiveChange: (item: PromptInputV2Suggestion) => void
  onSelect: (item: PromptInputV2Suggestion) => void
}) {
  return (
    <div
      class="absolute inset-x-0 -top-2 z-40 flex max-h-80 -translate-y-full flex-col overflow-auto rounded-xl bg-popover p-2 shadow-[0 1px 2px oklch(0% 0 none / 0.3)] no-scrollbar"
      onMouseDown={(event) => event.preventDefault()}
    >
      <Show when={props.search}>
        {(search) => (
          <div class="px-2 py-1">
            <input
              ref={(element) => requestAnimationFrame(() => element.focus())}
              value={search().value}
              aria-label={search().label}
              placeholder={search().placeholder}
              class="w-full bg-transparent text-[13px] leading-5 text-foreground outline-none placeholder:text-secondary-label"
              onInput={(event) => search().onValueChange(event.currentTarget.value)}
              onKeyDown={(event) => search().onKeyDown(event)}
              onMouseDown={(event) => event.stopPropagation()}
            />
          </div>
        )}
      </Show>
      <Show
        when={props.items.length > 0}
        fallback={<div class="px-2 py-1 text-muted-foreground">{props.emptyLabel}</div>}
      >
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              data-suggestion-id={item.id}
              class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-control"
              classList={{ "bg-control": props.activeID === item.id }}
              onPointerMove={() => props.onActiveChange(item)}
              onClick={() => props.onSelect(item)}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <PromptInputV2SuggestionIcon item={item} />
                <span class="shrink-0 text-foreground">{item.label}</span>
                <Show when={item.description}>
                  <span class="min-w-0 truncate text-muted-foreground">{item.description}</span>
                </Show>
              </div>
              <Show when={item.keybind?.length}>
                <span class="shrink-0 text-muted-foreground">{item.keybind?.join("+")}</span>
              </Show>
            </button>
          )}
        </For>
      </Show>
    </div>
  )
}

function PromptInputV2SuggestionIcon(props: { item: PromptInputV2Suggestion }) {
  if (props.item.kind === "agent" && props.item.mention?.type === "agent")
    return <IdentityAvatar seed={props.item.mention.name} size={18} />
  if (props.item.kind === "command") return null
  if (props.item.kind === "reference") return <FolderIcon class="size-4 shrink-0" aria-hidden="true" />
  return <EntryIcon path={props.item.path ?? props.item.label} />
}
