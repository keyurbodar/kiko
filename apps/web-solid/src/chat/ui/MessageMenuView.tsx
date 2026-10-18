import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CopyIcon, EditIcon, ExternalIcon, LinkIcon, PinIcon, ReactIcon, ReplyIcon, ShareIcon, TrashIcon, UnpinIcon } from "@kiko/ui/icons"
import { createSignal, For, lazy, Show, Suspense } from "solid-js"
import { cn } from "../../lib/cn"
import type { MessageMenuProps } from "./MessageMenu"
import { recentEmoji, recordRecent, warmEmoji } from "../../lib/emoji-data"
import { richTextSegments } from "../lib/richtext/segments"

const pickerModule = () => import("./EmojiPicker")
const EmojiPicker = lazy(() => pickerModule().then((m) => ({ default: m.EmojiPicker })))
const preloadEmojiPicker = () => {
  void pickerModule()
  warmEmoji()
}

const QUICK_COUNT = 5

export default function MessageMenu(props: MessageMenuProps) {
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
            pickerOpen() && "rounded-xl p-0",
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
                  <RemixIcon icon={ReactIcon} class="size-3.5" />
                </button>
              </div>
              <MenuV2.Separator />
              <Show when={link()}>
                {(url) => (
                  <>
                    <MenuV2.Item onSelect={openLink}>
                      <RemixIcon icon={ExternalIcon} class="size-3.5 shrink-0" />
                      Open link
                    </MenuV2.Item>
                    <MenuV2.Item onSelect={() => void copy(url(), "Link copied")}>
                      <RemixIcon icon={LinkIcon} class="size-3.5 shrink-0" />
                      Copy link
                    </MenuV2.Item>

                    <Show when={canShare}>
                      <MenuV2.Item onSelect={() => void shareLink()}>
                        <RemixIcon icon={ShareIcon} class="size-3.5 shrink-0" />
                        Share link
                      </MenuV2.Item>
                    </Show>
                    <MenuV2.Separator />
                  </>
                )}
              </Show>
              <MenuV2.Item onSelect={props.onReply}>
                <RemixIcon icon={ReplyIcon} class="size-3.5 shrink-0" />
                Reply
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => void copy()}>
                <RemixIcon icon={CopyIcon} class="size-3.5 shrink-0" />
                Copy
              </MenuV2.Item>
              <Show when={props.onTogglePin}>
                <MenuV2.Item onSelect={props.onTogglePin}>
                  <RemixIcon icon={props.pinned ? UnpinIcon : PinIcon} class="size-3.5 shrink-0" />
                  {props.pinned ? "Unpin" : "Pin"}
                </MenuV2.Item>
              </Show>

              <Show when={props.onEdit !== undefined || props.onDelete !== undefined}>
                <MenuV2.Separator />
              </Show>
              <Show when={props.side === "user" && props.onEdit}>
                <MenuV2.Item onSelect={props.onEdit}>
                  <RemixIcon icon={EditIcon} class="size-3.5 shrink-0" />
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
                  <RemixIcon icon={TrashIcon} class="size-3.5 shrink-0" />
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
