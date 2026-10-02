import { createEffect, createSignal, For, Show } from "solid-js"
import { FileIcon } from "@kiko/ui/file-icon"
import { useI18n } from "@kiko/ui/context/i18n"
import { Icon as IconV2 } from "@kiko/ui/v2/icon"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { CommentCardV2 } from "../comment-card-v2"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import type { PromptInputV2Attachment, PromptInputV2Comment, PromptInputV2Suggestion } from "./types"

/*
 * The parts of the composer that only show once there is something in them: the attachment
 * strip and the @ and / popover. index.tsx loads this module lazily, so they and FileIcon stay
 * out of first paint. The composer preloads it on idle.
 */

/** Carries the id of a chip being reordered. Not `text/plain`, which the dock reads as an @mention drop. */
const REORDER_TYPE = "application/x-kiko-attachment"

export function PromptInputV2Attachments(props: {
  attachments: PromptInputV2Attachment[]
  comments?: PromptInputV2Comment[]
  activeCommentID?: string
  removeLabel: string
  onAttachmentClick?: (attachment: PromptInputV2Attachment) => void
  onAttachmentRemove: (attachment: PromptInputV2Attachment) => void
  onAttachmentReorder?: (id: string, toId: string) => void
  onCommentClick?: (comment: PromptInputV2Comment) => void
  onCommentRemove?: (comment: PromptInputV2Comment) => void
}) {
  const i18n = useI18n()
  let scroller: HTMLDivElement | undefined
  const [dropTarget, setDropTarget] = createSignal<string>()
  /** Which edges have more strip beyond them, so each fade earns its place. */
  const [edges, setEdges] = createSignal({ start: false, end: false })
  const syncEdges = () => {
    const node = scroller
    if (!node) return
    // A single pixel of slack: a fractional layout width can leave the last
    // position a hair short of the end and strand the fade on screen.
    setEdges({
      start: node.scrollLeft > 1,
      end: node.scrollLeft < node.scrollWidth - node.clientWidth - 1,
    })
  }
  // The strip's own width changes when an attachment is added or removed, so
  // the fades have to be re-read after every list change, not just on scroll.
  // createEffect runs after the render phase, so the new cards are already in
  // the DOM by the time this reads scrollWidth.
  createEffect(() => {
    const count = props.attachments.length + (props.comments?.length ?? 0)
    void count
    syncEdges()
  })
  return (
    <Show when={props.attachments.length > 0 || (props.comments?.length ?? 0) > 0}>
      <div data-component="prompt-input-v2-attachments" data-slot="prompt-attachments" class="relative">
        <div
          ref={(element) => {
            scroller = element
          }}
          data-slot="prompt-attachments-scroll"
          onScroll={syncEdges}
          class="attachment-strip"
        >
          <For each={props.comments ?? []}>
            {(comment) => (
              <div class="relative group shrink-0">
                <TooltipV2
                  value={comment.comment}
                  placement="top"
                  openDelay={800}
                  contentClass="max-w-[300px] break-words"
                >
                  <CommentCardV2
                    comment={comment.comment ?? ""}
                    path={comment.path}
                    selection={comment.selection}
                    active={comment.key === props.activeCommentID}
                    onClick={() => props.onCommentClick?.(comment)}
                  />
                </TooltipV2>
                <button
                  type="button"
                  onClick={() => props.onCommentRemove?.(comment)}
                  class="absolute -top-1 -end-1 size-4 rounded-full bg-v2-icon-icon-muted outline-solid outline-1 outline-v2-icon-icon-contrast flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={props.removeLabel}
                >
                  <IconV2 name="outline-xmark" class="text-v2-icon-icon-contrast" />
                </button>
              </div>
            )}
          </For>
          <For each={props.attachments}>
            {(attachment) => {
              const isImage = () => attachment.mime.startsWith("image/")
              return (
                /* The tooltip wraps the chip rather than living inside it: its
                 * trigger is a wrapper element, and a wrapper inside the chip
                 * would become the flex item that kat's `gap: 6px` measures
                 * between the icon and the name. */
                <TooltipV2 value={attachment.filename} placement="top" contentClass="break-all">
                  <div
                    class="attachment-chip"
                    data-component="composer-attachment"
                    data-image={isImage() ? "" : undefined}
                    data-id={attachment.id}
                    data-drop={dropTarget() === attachment.id ? "" : undefined}
                    draggable={props.onAttachmentReorder !== undefined && props.attachments.length > 1}
                    onDragStart={(event) => {
                      event.dataTransfer?.setData(REORDER_TYPE, attachment.id)
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
                    }}
                    onDragOver={(event) => {
                      if (!event.dataTransfer?.types.includes(REORDER_TYPE)) return
                      event.preventDefault()
                      setDropTarget(attachment.id)
                    }}
                    onDragLeave={() => setDropTarget(undefined)}
                    onDragEnd={() => setDropTarget(undefined)}
                    onDrop={(event) => {
                      const id = event.dataTransfer?.getData(REORDER_TYPE)
                      setDropTarget(undefined)
                      if (!id) return
                      event.preventDefault()
                      event.stopPropagation()
                      props.onAttachmentReorder?.(id, attachment.id)
                    }}
                  >
                    <Show
                      when={isImage()}
                      fallback={
                        <>
                          <FileIcon
                            node={{ path: attachment.filename, type: "file" }}
                            class="attachment-file-icon"
                          />
                          <span class="attachment-filename">{attachment.filename}</span>
                        </>
                      }
                    >
                      <button
                        type="button"
                        class="attachment-thumb-button"
                        onClick={() => props.onAttachmentClick?.(attachment)}
                        aria-label={`open ${attachment.filename}`}
                      >
                        <img
                          src={attachment.blob.url}
                          alt={attachment.filename}
                          class="attachment-thumb"
                        />
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="attachment-remove"
                      onClick={() => props.onAttachmentRemove(attachment)}
                      aria-label={props.removeLabel}
                    >
                      <IconV2 name="outline-xmark" />
                    </button>
                  </div>
                </TooltipV2>
              )
            }}
          </For>
        </div>
        <div
          data-slot="prompt-attachments-fade-left"
          classList={{ invisible: !edges().start }}
          class="pointer-events-none absolute inset-y-0 start-0 z-10 w-6 bg-[linear-gradient(to_right,var(--v2-background-bg-base),transparent)] rtl:bg-[linear-gradient(to_left,var(--v2-background-bg-base),transparent)]"
        />
        <div
          data-slot="prompt-attachments-fade-right"
          classList={{ invisible: !edges().end }}
          class="pointer-events-none absolute inset-y-0 end-0 z-10 w-6 bg-[linear-gradient(to_left,var(--v2-background-bg-base),transparent)] rtl:bg-[linear-gradient(to_right,var(--v2-background-bg-base),transparent)]"
        />
      </div>
    </Show>
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
