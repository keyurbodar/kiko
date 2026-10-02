import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { Copy, CornerUpLeft, Pencil, Pin, Plus, Trash2 } from "lucide-solid"
import { createSignal, For, lazy, Show, Suspense, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { ChatMessage } from "../../lib/types"
import { Emoji } from "../../lib/emoji"

/* The picker wrapper loads when a menu opens, not with the transcript. */
const pickerModule = () => import("./EmojiPicker")
const EmojiPicker = lazy(() => pickerModule().then((m) => ({ default: m.EmojiPicker })))
const preloadEmojiPicker = () => void pickerModule().then((m) => m.preloadEmojiPicker())

export interface MessageMenuOptions {
  message: ChatMessage
  side: "user" | "bot"
  /** True when the message is pinned; the row reads `unpin` instead of `pin`. */
  pinned?: boolean
  onOpenChange?: (open: boolean) => void
  onReply: () => void
  /** Omitted while there is no store mutation behind it; the item is then not
   *  rendered at all, because a menu entry that swallows a click is a lie. */
  onTogglePin?: () => void
  /** Never rendered for the agent's messages. */
  onEdit?: () => void
  onDelete?: () => void
  onReact: (emoji: string) => void
}

export interface MessageMenuProps extends MessageMenuOptions {
  ref?: (element: HTMLElement) => void
  /**
   * Where the zero-size trigger sits. It is never seen and never hit: it only
   * receives the replayed event, and the menu is positioned from that event's
   * coordinates rather than from the trigger's box.
   */
  style?: JSX.CSSProperties
}

export interface MessageMenuController {
  /** Wire this to Bubble's `onContextMenu`. */
  onContextMenu: (event: MouseEvent) => void
  /** Render this once, anywhere in the tree. */
  view: JSX.Element
}

/**
 * The five reactions offered without opening the picker, as literals.
 *
 * They used to be resolved out of an emojibase build by shortcode. Nothing
 * needs that any more: these five are a fixed set of characters, and the
 * picker's own shortcodes come from the element's data. So the database, its
 * search index and both emojibase dependencies are gone.
 */
const QUICK_REACTIONS: readonly { readonly emoji: string; readonly label: string }[] = [
  { emoji: "👍", label: "thumbs up" },
  { emoji: "❤️", label: "heart" },
  { emoji: "😂", label: "joy" },
  { emoji: "😮", label: "surprised" },
  { emoji: "🙏", label: "folded hands" },
]

/**
 * The message menu, identical for the viewer's and the agent's messages apart
 * from `edit`, which the agent's never offers.
 */
export function MessageMenu(props: MessageMenuProps) {
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.message.body)
      showToastV2({ title: "copied", variant: "success" })
    } catch {
      showToastV2({
        title: "could not copy",
        description: "the clipboard is not available in this context",
        variant: "error",
      })
    }
  }

  return (
    <MenuV2.Context
      gutter={8}
      onOpenChange={(open) => {
        // A reader who has just opened the menu is deciding what to react with,
        // so this is the moment to start pulling the picker's module and data.
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
            // `chat-menu` is a QA handle as well as the surface: the verify
            // skill scopes the quick strip by it.
            //
            // These sizes only take effect because the vendored menu stylesheet
            // sits in `@layer v2`, below `utilities` - unlayered it beat every
            // one of them and the menu rendered at the library's 2px padding,
            // 6px radius and 13px rows instead.
            "chat-menu min-w-[200px] rounded-[calc(20px*var(--brm))] p-2",
            // Painted, not inherited: the vendored v2 menu resolves its own
            // light ramp, so the kat roles have to be stated here.
            "border-none bg-menu text-base text-text shadow-menu",
            // One item rhythm for every row in the menu: kat's rows are taller
            // and set larger than the library default, and every entry carries
            // a leading glyph. The row itself is `data-component`, NOT
            // `data-slot` - only the inner content span is a slot.
            "[&_[data-component=menu-v2-item]]:h-10",
            "[&_[data-slot=menu-v2-item-content]]:text-base",
            "[&_[data-slot=menu-v2-item-content]]:gap-2.5",
          )}
          data-component="chat-menu"
        >
        <Show
          when={pickerOpen()}
          fallback={
            <>
              <div class="chat-menu__quick flex gap-0.5 p-1 mb-2">
                <For each={QUICK_REACTIONS}>
                  {(entry) => (
                    <button
                      type="button"
                      class={cn(
                        // `text-inherit` is NOT here on purpose: `cn` merges by
                        // Tailwind's font-size group, so it and `text-[22px]` were
                        // treated as one property and the size utility was dropped,
                        // leaving every emoji at the inherited 14px. Preflight
                        // already gives a button `color: inherit`.
                        "chat-menu__emoji flex size-9 items-center justify-center rounded-xl p-0 text-[22px] leading-none",
                        "cursor-default border-none bg-transparent",
                        "hover:bg-[oklch(from_var(--accent)_l_c_h_/_12%)]",
                        "focus-visible:bg-[oklch(from_var(--accent)_l_c_h_/_12%)]",
                        // One of the three permitted motions.
                        "active:scale-[0.85]",
                      )}
                      data-emoji={entry.emoji}
                      aria-label={entry.label}
                      onClick={() => props.onReact(entry.emoji)}
                    >
                      <Emoji emoji={entry.emoji} class="size-[22px] align-middle" eager />
                    </button>
                  )}
                </For>
                <button
                  type="button"
                  class={cn(
                    "chat-menu__more flex size-9 items-center justify-center rounded-xl p-0",
                    "cursor-default border-none bg-transparent text-weak",
                    "hover:bg-[oklch(from_var(--accent)_l_c_h_/_12%)]",
                    "hover:text-text focus-visible:bg-[oklch(from_var(--accent)_l_c_h_/_12%)]",
                    "focus-visible:text-text",
                  )}
                  aria-label="more emoji"
                  aria-expanded={pickerOpen()}
                  onClick={() => setPickerOpen(true)}
                >
                  <Plus class="size-4" aria-hidden="true" />
                </button>
              </div>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={props.onReply}>
                <CornerUpLeft class="size-4 shrink-0" aria-hidden="true" />
                reply
              </MenuV2.Item>
              <MenuV2.Item onSelect={copy}>
                <Copy class="size-4 shrink-0" aria-hidden="true" />
                copy
              </MenuV2.Item>
              <Show when={props.onTogglePin}>
                <MenuV2.Item onSelect={props.onTogglePin}>
                  <Pin class="size-4 shrink-0" aria-hidden="true" />
                  {props.pinned ? "unpin" : "pin"}
                </MenuV2.Item>
              </Show>
              {/* The divider only appears when something follows it. */}
              <Show when={props.onEdit !== undefined || props.onDelete !== undefined}>
                <MenuV2.Separator />
              </Show>
              <Show when={props.side === "user" && props.onEdit}>
                <MenuV2.Item onSelect={props.onEdit}>
                  <Pencil class="size-4 shrink-0" aria-hidden="true" />
                  edit
                </MenuV2.Item>
              </Show>
              <Show when={props.onDelete}>
                <MenuV2.Item
                  class={cn(
                    "chat-menu__danger text-danger",
                    "hover:bg-[oklch(from_var(--danger)_l_c_h_/_12%)]",
                    "focus-visible:bg-[oklch(from_var(--danger)_l_c_h_/_12%)]",
                  )}
                  onSelect={props.onDelete}
                >
                  <Trash2 class="size-4 shrink-0" aria-hidden="true" />
                  delete
                </MenuV2.Item>
              </Show>
            </>
          }
        >
          {/* The picker takes the WHOLE surface. The quick strip and the actions
              are inside the fallback above rather than beside this, because kat's
              picker replaces the menu outright: leaving the five quick emoji
              stacked above it reads as two half-panels, and the reader who opened
              the picker to browse has already decided against the quick five.
              Escape and an outside click close the menu, so there is no way back
              and none is needed. */}
          <div class="chat-menu__picker">
            <Suspense>
              <EmojiPicker
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

/**
 * Owns the menu's open state for a row that only forwards its `contextmenu`
 * event. Kobalte's context menu is uncontrolled — it opens when a real
 * `contextmenu` event reaches its trigger and takes the anchor rect off that
 * event — so the integration is to park a zero-size trigger somewhere inert
 * and replay the row's event onto it at the pointer's coordinates.
 *
 * The `targetId` is the message id of the row that was actually under the
 * pointer when the menu opened, and it is written HERE, at open time — not at
 * render time. The option callbacks close over whatever message was current
 * when the row rendered, and under a virtualizer that row's DOM is recycled
 * into a different message by the time the click lands, so anything but the
 * opened-on id names the wrong row.
 */
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
    <Show when={targetId()} fallback={<MessageMenu {...{ ...options, message: fallback } as MessageMenuProps} ref={setTrigger} />}>
      {(id) => <MessageMenu {...liveProps()} ref={setTrigger} />}
    </Show>
  )
  return {
    targetId,
    onContextMenu: (event) => {
      event.preventDefault()
      const id = (event.currentTarget as HTMLElement | null)?.dataset.messageId
        ?? (event.target as HTMLElement | null)?.closest?.("[data-message-id]")?.getAttribute("data-message-id")
        ?? null
      setTargetId(id)
      trigger()?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      )
    },
    view,
  }
}
