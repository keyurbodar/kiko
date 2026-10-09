import { For, Show } from "solid-js"
import { FileIcon } from "@yuki/ui/file-icon"
import { HugeIcon } from "@yuki/ui/huge-icon"
import { CloseIcon, UndoIcon } from "@yuki/ui/icons"
import { TooltipV2 } from "@yuki/ui/v2/tooltip-v2"
import { formatBytes } from "../../chat/info/format"
import { isImage } from "../../lib/attachments"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { progressLabel, retryUpload, uploadState } from "../../sync/uploads"
import type { PromptInputV2Attachment, PromptInputV2Suggestion } from "./types"

/*
 * The parts of the composer that only show once there is something in them: the attachment
 * strip and the @ and / popover. index.tsx loads this module lazily, so they and FileIcon stay
 * out of first paint. The composer preloads it on idle.
 *
 * The strip is t3code's: pictures as 64px square thumbnails that open the image dialog, each with
 * a remove button on its corner, and other files as rows under them with their size. While a file
 * uploads, a thumbnail shows its percentage along its bottom edge and a row shows it in place of
 * the size; a failed upload shows a retry button whose tooltip says why.
 */

/** t3code's retry button: a small dark overlay button with the reason in its tooltip. */
function RetryButton(props: { name: string; reason: string; class: string; onRetry: () => void }) {
  return (
    <TooltipV2 placement="top" value={props.reason}>
      <button
        type="button"
        class={props.class}
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
  const picture = (a: PromptInputV2Attachment) => isImage({ name: a.filename, type: a.mime })
  const images = () => props.attachments.filter(picture)
  const others = () => props.attachments.filter((a) => !picture(a))
  const failure = (id: string) => {
    const upload = uploadState(id)
    return upload?.status === "failed" ? upload.reason : null
  }
  const progressOf = (id: string) => {
    const upload = uploadState(id)
    return upload?.status === "uploading" ? progressLabel(upload.progress) : null
  }
  return (
    <div data-component="prompt-input-v2-attachments" data-slot="prompt-attachments" class="flex flex-[0_0_100%] flex-col gap-2 px-1 pt-0.5">
      <Show when={images().length > 0}>
        <div class="flex max-w-full flex-wrap gap-2">
          <For each={images()}>
            {(attachment) => (
              <div class="relative size-16 shrink-0 overflow-hidden rounded-lg border border-hairline/80 bg-bg" data-component="composer-attachment" data-image="" data-id={attachment.id}>
                <button
                  type="button"
                  class="size-full cursor-zoom-in"
                  aria-label={`Preview ${attachment.filename}`}
                  onClick={() => props.onImageClick?.(attachment)}
                >
                  <img src={attachment.blob.url} alt={attachment.filename} class="size-full object-cover" draggable={false} />
                </button>
                <Show when={progressOf(attachment.id)}>
                  {(label) => (
                    <span data-slot="upload-progress" class="pointer-events-none absolute inset-x-0 bottom-0 bg-bg/85 px-1 text-center text-[10px] leading-[14px] text-text">
                      {label()}
                    </span>
                  )}
                </Show>
                <Show when={failure(attachment.id)}>
                  {(reason) => (
                    <RetryButton
                      name={attachment.filename}
                      reason={reason()}
                      class="absolute bottom-1 left-1 grid size-5 place-items-center rounded-sm bg-black/70 text-white/65 hover:bg-black/90 hover:text-white"
                      onRetry={() => retryUpload(attachment.id)}
                    />
                  )}
                </Show>
                <button
                  type="button"
                  class="absolute top-1 right-1 grid size-5 place-items-center rounded-md bg-black/65 text-white shadow-sm ring-1 ring-white/20 hover:bg-black/80 focus-visible:ring-white"
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() => props.onRemove(attachment)}
                >
                  <HugeIcon icon={CloseIcon} size={12} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={others().length > 0}>
        <div class="flex flex-col gap-1">
          <For each={others()}>
            {(attachment) => (
              <div class="flex min-w-0 items-center gap-2 py-1 text-sm text-text" data-component="composer-attachment" data-id={attachment.id}>
                <FileIcon node={{ path: attachment.filename, type: "file" }} class="size-4 shrink-0" />
                <span class="min-w-0 flex-1 truncate" title={attachment.filename}>
                  {attachment.filename}
                </span>
                <span class="shrink-0 text-xs text-muted" data-slot="upload-progress">
                  {progressOf(attachment.id) ?? formatBytes(attachment.size)}
                </span>
                <Show when={failure(attachment.id)}>
                  {(reason) => (
                    <RetryButton
                      name={attachment.filename}
                      reason={reason()}
                      class="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
                      onRetry={() => retryUpload(attachment.id)}
                    />
                  )}
                </Show>
                <button
                  type="button"
                  class="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() => props.onRemove(attachment)}
                >
                  <HugeIcon icon={CloseIcon} size={14} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
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
