import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { CopyIcon, ExternalLinkIcon, LinkIcon, PencilIcon, PinIcon, ReplyIcon, Share2Icon, SmilePlusIcon, Trash2Icon } from "lucide-solid"
import { createSignal, For, lazy, Show, Suspense, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { ChatMessage } from "../../lib/types"
import { recentEmoji, recordRecent, warmEmoji } from "../../lib/emoji-data"
import { richTextSegments } from "../lib/richtext/segments"

const pickerModule = () => import("./EmojiPicker")
const EmojiPicker = lazy(() => pickerModule().then((m) => ({ default: m.EmojiPicker })))
const preloadEmojiPicker = () => {
  void pickerModule()
  warmEmoji()
}

export interface MessageMenuOptions {
  message: ChatMessage
  side: "user" | "bot"
  pinned?: boolean
  onOpenChange?: (open: boolean) => void
  onReply: () => void
  onTogglePin?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onReact: (emoji: string) => void
}

export interface MessageMenuProps extends MessageMenuOptions {
  ref?: (element: HTMLElement) => void
  style?: JSX.CSSProperties
}

export interface MessageMenuController {
  onContextMenu: (event: MouseEvent) => void
  openAt: (messageId: string, x: number, y: number) => void
  view: JSX.Element
}

const QUICK_COUNT = 5

export function MessageMenu(props: MessageMenuProps) {
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const link = () => richTextSegments(props.message.body).find((s) => s.kind === "url" && !s.suspicious && s.href)?.href ?? null
  const openLink = () => {
    const url = link()
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function"
  const shareLink = async () => {
    const url = link()
    if (!url) return
    try {
      await navigator.share({ url })
    } catch {
    }
  }
  const copy = async (text = props.message.body, done = "Copied") => {
    try {
      await navigator.clipboard.writeText(text)
      showToastV2({ title: done, variant: "success" })
    } catch {
      showToastV2({
        title: "Could not copy",
        description: "The clipboard is not available in this context",
        variant: "error",
      })
    }
  }

  return (
    <MenuV2.Context
      gutter={8}
      onOpenChange={(open) => {
        if (open) preloadEmojiPicker()
        props.onOpenChange?.(open)
      }}
    >
      <MenuV2.Context.Trigger
        ref={props.ref}
        class="chat-menu__trigger"
        style={{ position: "fixed", left: 0, top: 0, width: 0, height: 0, "pointer-events": "none", ...props.style }}
      />
      <MenuV2.Context.Portal>
        <MenuV2.Context.Content
          class={cn(
            "chat-menu min-w-[184px] rounded-xl p-1 text-foreground",
            pickerOpen() && "rounded-[20px] p-0",
            "[&_[data-component=menu-v2-item]]:h-[30px]",
            "[&_[data-slot=menu-v2-item-content]]:text-[13px]",
            "[&_[data-slot=menu-v2-item-content]]:gap-2.5",
            "[&_[data-component=menu-v2-item]_svg]:text-muted-foreground",
          )}
          data-component="chat-menu"
        >
        <Show
          when={pickerOpen()}
          fallback={
            <>
              <div class="chat-menu__quick flex items-center gap-0.5 px-0.5 pt-0.5 pb-1">
                <For each={recentEmoji().slice(0, QUICK_COUNT)}>
                  {(emoji) => (
                    <button
                      type="button"
                      class={cn(
                        "chat-menu__emoji flex size-8 items-center justify-center rounded-lg p-0 font-emoji text-[20px] leading-none",
                        "cursor-default border-none bg-transparent",
                        "hover:bg-[var(--accent-strong)]",
                        "focus-visible:bg-[var(--accent-strong)]",
                        "active:scale-[0.92]",
                      )}
                      data-emoji={emoji}
                      aria-label={`React with ${emoji}`}
                      onClick={() => {
                        recordRecent(emoji)
                        props.onReact(emoji)
                      }}
                    >
                      {emoji}
                    </button>
                  )}
                </For>
                <button
                  type="button"
                  class={cn(
                    "chat-menu__more ml-auto flex size-8 items-center justify-center rounded-lg p-0",
                    "cursor-default border-none bg-transparent text-muted-foreground",
                    "hover:bg-[var(--accent-strong)]",
                    "hover:text-foreground focus-visible:bg-[var(--accent-strong)]",
                    "focus-visible:text-foreground",
                  )}
                  aria-label="More emoji"
                  aria-expanded={pickerOpen()}
                  onClick={() => setPickerOpen(true)}
                >
                  <SmilePlusIcon class="size-3.5" aria-hidden="true" />
                </button>
              </div>
              <MenuV2.Separator />
              <Show when={link()}>
                {(url) => (
                  <>
                    <MenuV2.Item onSelect={openLink}>
                      <ExternalLinkIcon class="size-3.5 shrink-0" aria-hidden="true" />
                      Open link
                    </MenuV2.Item>
                    <MenuV2.Item onSelect={() => void copy(url(), "Link copied")}>
                      <LinkIcon class="size-3.5 shrink-0" aria-hidden="true" />
                      Copy link
                    </MenuV2.Item>

                    <Show when={canShare}>
                      <MenuV2.Item onSelect={() => void shareLink()}>
                        <Share2Icon class="size-3.5 shrink-0" aria-hidden="true" />
                        Share link
                      </MenuV2.Item>
                    </Show>
                    <MenuV2.Separator />
                  </>
                )}
              </Show>
              <MenuV2.Item onSelect={props.onReply}>
                <ReplyIcon class="size-3.5 shrink-0" aria-hidden="true" />
                Reply
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => void copy()}>
                <CopyIcon class="size-3.5 shrink-0" aria-hidden="true" />
                Copy
              </MenuV2.Item>
              <Show when={props.onTogglePin}>
                <MenuV2.Item onSelect={props.onTogglePin}>
                  <PinIcon class="size-3.5 shrink-0" aria-hidden="true" />
                  {props.pinned ? "Unpin" : "Pin"}
                </MenuV2.Item>
              </Show>

              <Show when={props.onEdit !== undefined || props.onDelete !== undefined}>
                <MenuV2.Separator />
              </Show>
              <Show when={props.side === "user" && props.onEdit}>
                <MenuV2.Item onSelect={props.onEdit}>
                  <PencilIcon class="size-3.5 shrink-0" aria-hidden="true" />
                  Edit
                </MenuV2.Item>
              </Show>
              <Show when={props.onDelete}>
                <MenuV2.Item
                  class={cn(
                    "chat-menu__danger text-error [&_svg]:!text-[var(--error)]",
                  )}
                  onSelect={props.onDelete}
                >
                  <Trash2Icon class="size-3.5 shrink-0" aria-hidden="true" />
                  Delete
                </MenuV2.Item>
              </Show>
            </>
          }
        >

          <div class="chat-menu__picker">
            <Suspense>
              <EmojiPicker
                class="bg-transparent shadow-none"
                onSelect={(emoji) => {
                  props.onReact(emoji)
                  setPickerOpen(false)
                }}
              />
            </Suspense>
          </div>
        </Show>
        </MenuV2.Context.Content>
      </MenuV2.Context.Portal>
    </MenuV2.Context>
  )
}

export function createMessageMenu(
  options: Omit<MessageMenuOptions, "message"> & { messageFor: (messageId: string) => ChatMessage },
): MessageMenuController & { targetId: () => string | null } {
  const [trigger, setTrigger] = createSignal<HTMLElement>()
  const [targetId, setTargetId] = createSignal<string | null>(null)
  const fallback: ChatMessage = { id: "__none__", threadId: "", sender: "bot", body: "", sentAt: 0 }
  const liveProps = (): MessageMenuProps => {
    const id = targetId()
    return { ...options, message: id === null ? fallback : options.messageFor(id) } as MessageMenuProps
  }
  const view = (
    <Show when={targetId()}>
      <MessageMenu {...liveProps()} ref={setTrigger} />
    </Show>
  )
  const openAt = (id: string | null, x: number, y: number) => {
    setTargetId(id)
    trigger()?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    )
  }
  return {
    targetId,
    onContextMenu: (event) => {
      event.preventDefault()
      const id = (event.currentTarget as HTMLElement | null)?.dataset.messageId
        ?? (event.target as HTMLElement | null)?.closest?.("[data-message-id]")?.getAttribute("data-message-id")
        ?? null
      openAt(id, event.clientX, event.clientY)
    },
    openAt,
    view,
  }
}
