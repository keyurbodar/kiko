import { For, Show } from "solid-js"
import { FileIcon } from "@kiko/ui/file-icon"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { CloseIcon, UndoIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { isImage } from "../../lib/attachments"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { progressLabel, retryUpload, uploadState } from "../../sync/uploads"
import type { PromptInputV2Attachment, PromptInputV2Suggestion } from "./types"

const RING = 2 * Math.PI * 15

function RetryButton(props: { name: string; reason: string; onRetry: () => void }) {
  return (
    <TooltipV2 placement="top" value={props.reason}>
      <button
        type="button"
        class="composer-picture-retry"
        aria-label={`Retry upload for ${props.name}`}
        data-action="retry-upload"
        onClick={(event) => {
          event.stopPropagation()
          props.onRetry()
        }}
      >
        <HugeIcon icon={UndoIcon} size={12} />
      </button>
    </TooltipV2>
  )
}

export function PromptInputV2Attachments(props: {
  attachments: PromptInputV2Attachment[]
  onImageClick?: (attachment: PromptInputV2Attachment) => void
  onRemove: (attachment: PromptInputV2Attachment) => void
}) {
  const pictures = () => props.attachments.filter((a) => isImage({ name: a.filename, type: a.mime }))
  return (
    <div data-component="prompt-input-v2-attachments" data-slot="prompt-attachments" class="composer-pictures">
      <For each={pictures()}>
        {(attachment) => {
          const upload = () => uploadState(attachment.id)
          return (
            <div class="composer-picture" data-component="composer-attachment" data-image="" data-id={attachment.id} data-state={upload()?.status}>
              <button type="button" class="composer-picture-open" aria-label={`Preview ${attachment.filename}`} onClick={() => props.onImageClick?.(attachment)}>
                <img src={attachment.blob.url} alt={attachment.filename} draggable={false} />
              </button>
              <Show when={upload()?.status === "uploading"}>
                <svg class="composer-picture-ring" viewBox="0 0 36 36" data-slot="upload-progress" aria-label={progressLabel((upload() as { progress: number }).progress)}>
                  <circle cx="18" cy="18" r="15" />
                  <circle cx="18" cy="18" r="15" stroke-dasharray={String(RING)} stroke-dashoffset={String(RING * (1 - (upload() as { progress: number }).progress))} />
                </svg>
              </Show>
              <Show when={failure(upload())}>
                {(reason) => <RetryButton name={attachment.filename} reason={reason()} onRetry={() => retryUpload(attachment.id)} />}
              </Show>
              <button type="button" class="composer-picture-remove" aria-label={`Remove ${attachment.filename}`} onClick={() => props.onRemove(attachment)}>
                <HugeIcon icon={CloseIcon} size={12} />
              </button>
            </div>
          )
        }}
      </For>
    </div>
  )
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
      class="absolute inset-x-0 -top-2 z-40 flex max-h-80 -translate-y-full flex-col overflow-auto rounded-xl bg-v2-background-bg-base p-2 shadow-[var(--v2-elevation-raised)] no-scrollbar"
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
              class="w-full bg-transparent text-[13px] leading-5 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
              onInput={(event) => search().onValueChange(event.currentTarget.value)}
              onKeyDown={(event) => search().onKeyDown(event)}
              onMouseDown={(event) => event.stopPropagation()}
            />
          </div>
        )}
      </Show>
      <Show
        when={props.items.length > 0}
        fallback={<div class="px-2 py-1 text-v2-text-text-muted">{props.emptyLabel}</div>}
      >
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              data-suggestion-id={item.id}
              class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-v2-overlay-simple-overlay-hover"
              classList={{ "bg-v2-overlay-simple-overlay-hover": props.activeID === item.id }}
              onPointerMove={() => props.onActiveChange(item)}
              onClick={() => props.onSelect(item)}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <PromptInputV2SuggestionIcon item={item} />
                <span class="shrink-0 text-v2-text-text-base">{item.label}</span>
                <Show when={item.description}>
                  <span class="min-w-0 truncate text-v2-text-text-muted">{item.description}</span>
                </Show>
              </div>
              <Show when={item.keybind?.length}>
                <span class="shrink-0 text-v2-text-text-muted">{item.keybind?.join("+")}</span>
              </Show>
            </button>
          )}
        </For>
      </Show>
    </div>
  )
}

function PromptInputV2SuggestionIcon(props: { item: PromptInputV2Suggestion }) {
  // An agent wears its own face, so the list reads like the transcript. The mention's name is the slug.
  if (props.item.kind === "agent" && props.item.mention?.type === "agent")
    return <IdentityAvatar seed={props.item.mention.name} size={18} />
  if (props.item.kind === "command") return null
  return (
    <FileIcon
      node={{ path: props.item.path ?? props.item.label, type: props.item.kind === "reference" ? "directory" : "file" }}
      class="size-4 shrink-0"
    />
  )
}
