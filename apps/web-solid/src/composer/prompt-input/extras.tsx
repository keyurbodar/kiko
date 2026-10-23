import { For, Show } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, FolderIcon, UndoIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { EntryIcon } from "../../lib/EntryIcon"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { progressLabel, retryUpload, uploadState } from "../uploads"
import type { PromptInputV2Attachment, PromptInputV2Suggestion } from "./types"

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
        <RemixIcon icon={UndoIcon} size={11} />
      </button>
    </TooltipV2>
  )
}

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
          const failure = () => {
            const u = upload()
            return u?.status === "failed" ? u.reason : null
          }
          return (
            <div
              class="composer-attachment"
              data-component="composer-attachment"
              data-id={attachment.id}
              data-state={upload()?.status}
              title={failure() ?? attachment.filename}
            >
              <button
                type="button"
                class="composer-attachment-open"
                aria-label={`Preview ${attachment.filename}`}
                onClick={() => props.onImageClick?.(attachment)}
              >
                <img src={attachment.blob.url} alt={attachment.filename} draggable={false} />
              </button>
              <Show when={upload()?.status === "uploading" && upload()}>
                {(u) => (
                  <span class="composer-attachment-progress" aria-hidden="true">
                    {progressLabel((u() as { progress: number }).progress)}
                  </span>
                )}
              </Show>
              <Show when={failure()}>
                {(reason) => (
                  <RetryButton
                    name={attachment.filename}
                    reason={reason()}
                    onRetry={() => retryUpload(attachment.id)}
                  />
                )}
              </Show>
              <button
                type="button"
                class="composer-attachment-remove"
                aria-label={`Remove ${attachment.filename}`}
                onClick={() => props.onRemove(attachment)}
              >
                <RemixIcon icon={CloseIcon} size={11} />
              </button>
            </div>
          )
        }}
      </For>
    </div>
  )
}

export function PromptInputV2Popover(props: {
  id: string
  label: string
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
  const activeIndex = () => props.items.findIndex((item) => item.id === props.activeID)
  return (
    <div
      class="absolute inset-x-0 -top-2 z-40 flex max-h-80 -translate-y-full flex-col overflow-auto rounded-xl border border-border/60 bg-popover p-2 shadow-card no-scrollbar"
      data-component="prompt-input-v2-popover"
      onMouseDown={(event) => event.preventDefault()}
    >
      <Show when={props.search}>
        {(search) => (
          <div class="px-2 py-1">
            <input
              ref={(element) => requestAnimationFrame(() => element.focus())}
              value={search().value}
              aria-label={search().label}
              aria-controls={props.id}
              aria-activedescendant={activeIndex() >= 0 ? `${props.id}-opt-${activeIndex()}` : undefined}
              placeholder={search().placeholder}
              class="w-full bg-transparent text-[13px] leading-5 text-foreground outline-none placeholder:text-secondary-label"
              onInput={(event) => search().onValueChange(event.currentTarget.value)}
              onKeyDown={(event) => search().onKeyDown(event)}
              onMouseDown={(event) => event.stopPropagation()}
            />
          </div>
        )}
      </Show>
      <div id={props.id} role="listbox" aria-label={props.label}>
        <Show
          when={props.items.length > 0}
          fallback={<div class="px-2 py-1 text-muted-foreground">{props.emptyLabel}</div>}
        >
          <For each={props.items}>
            {(item, index) => (
              <div
                id={`${props.id}-opt-${index()}`}
                role="option"
                tabIndex={-1}
                aria-selected={activeIndex() === index()}
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
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

function PromptInputV2SuggestionIcon(props: { item: PromptInputV2Suggestion }) {
  if (props.item.kind === "agent" && props.item.mention?.type === "agent")
    return <IdentityAvatar seed={props.item.mention.name} size={18} />
  if (props.item.kind === "command") return null
  if (props.item.kind === "reference") return <RemixIcon icon={FolderIcon} class="size-4 shrink-0" />
  return <EntryIcon path={props.item.path ?? props.item.label} />
}
