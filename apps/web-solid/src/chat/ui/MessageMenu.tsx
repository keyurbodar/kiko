import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal, For, Show, type JSX } from "solid-js"
import type { ChatMessage } from "../../lib/types"
import { resolveShortcode, type EmojiEntry } from "../lib/emojiData"
import "../interactions.css"

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

const QUICK_REACTIONS: readonly EmojiEntry[] = ["+1", "heart", "joy", "open_mouth", "folded_hands"]
  .map((shortcode) => resolveShortcode(shortcode))
  .filter((entry): entry is EmojiEntry => entry !== undefined)

/**
 * The message menu, identical for the viewer's and the agent's messages apart
 * from `edit`, which the agent's never offers.
 */
export function MessageMenu(props: MessageMenuProps) {
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
    <MenuV2.Context gutter={8} onOpenChange={props.onOpenChange}>
      <MenuV2.Context.Trigger
        ref={props.ref}
        class="chat-menu__trigger"
        style={{ position: "fixed", left: 0, top: 0, width: 0, height: 0, "pointer-events": "none", ...props.style }}
      />
      <MenuV2.Context.Portal>
        <MenuV2.Context.Content class="chat-menu" data-component="chat-menu">
          <div class="chat-menu__quick">
            <For each={QUICK_REACTIONS}>
              {(entry) => (
                <button
                  type="button"
                  class="chat-menu__emoji"
                  data-emoji={entry.emoji}
                  aria-label={entry.label}
                  onClick={() => props.onReact(entry.emoji)}
                >
                  {entry.emoji}
                </button>
              )}
            </For>
          </div>
          <MenuV2.Separator />
          <MenuV2.Item onSelect={props.onReply}>reply</MenuV2.Item>
          <MenuV2.Item onSelect={copy}>copy</MenuV2.Item>
          <Show when={props.onTogglePin}>
            <MenuV2.Item onSelect={props.onTogglePin}>
              {props.pinned ? "unpin" : "pin"}
            </MenuV2.Item>
          </Show>
          {/* The divider only appears when something follows it. */}
          <Show when={props.onEdit !== undefined || props.onDelete !== undefined}>
            <MenuV2.Separator />
          </Show>
          <Show when={props.side === "user" && props.onEdit}>
            <MenuV2.Item onSelect={props.onEdit}>edit</MenuV2.Item>
          </Show>
          <Show when={props.onDelete}>
            <MenuV2.Item class="chat-menu__danger" onSelect={props.onDelete}>
              delete
            </MenuV2.Item>
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
 */
export function createMessageMenu(options: MessageMenuOptions): MessageMenuController {
  const [trigger, setTrigger] = createSignal<HTMLElement>()

  return {
    onContextMenu: (event) => {
      event.preventDefault()
      trigger()?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      )
    },
    view: <MessageMenu {...options} ref={setTrigger} />,
  }
}
