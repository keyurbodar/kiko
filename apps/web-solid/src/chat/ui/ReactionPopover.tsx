import { createEventListener } from "@solid-primitives/event-listener"
import { createSignal, For, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { recentEmoji, recordRecent } from "../../lib/emoji-data"
import { EmojiPicker } from "./EmojiPicker"

const QUICK = 13
const POPOVER = { width: 7 * 40 + 16, height: 2 * 40 + 16 }
const PICKER = { width: 340, height: 400 }
const GAP = 8
const EDGE = 8

export function placeAbove(
  anchor: { top: number; bottom: number; left: number; width: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const above = anchor.top - GAP - size.height
  const below = anchor.bottom + GAP
  const top =
    above >= EDGE
      ? above
      : below + size.height <= viewport.height - EDGE
        ? below
        : Math.max(EDGE, viewport.height - EDGE - size.height)
  const centered = anchor.left + anchor.width / 2 - size.width / 2
  const left = Math.min(Math.max(EDGE, centered), Math.max(EDGE, viewport.width - EDGE - size.width))
  return { left, top }
}

export function ReactionPopover(props: {
  anchor: HTMLElement
  focus?: boolean
  onPick: (emoji: string) => void
  onClose: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}): JSX.Element {
  const [full, setFull] = createSignal(false)
  let panel: HTMLDivElement | undefined
  const place = () => {
    const rect = props.anchor.getBoundingClientRect()
    const at = placeAbove(rect, full() ? PICKER : POPOVER, { width: window.innerWidth, height: window.innerHeight })
    // It grows out of the side that faces the button it came from.
    return { left: `${at.left}px`, top: `${at.top}px`, "transform-origin": at.top < rect.top ? "50% 100%" : "50% 0" }
  }
  const pick = (emoji: string) => {
    recordRecent(emoji)
    props.onPick(emoji)
  }

  createEventListener(window, "keydown", (event) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
    props.anchor.focus({ preventScroll: true })
  }, { capture: true })
  createEventListener(document, "pointerdown", (event) => {
    const target = event.target as Node
    if (!panel?.contains(target) && !props.anchor.contains(target)) props.onClose()
  })

  return (
    <Portal>
      <div
        ref={(element) => {
          panel = element
          if (props.focus) queueMicrotask(() => element.querySelector<HTMLElement>("button")?.focus())
        }}
        class="motion-popover-in fixed z-50"
        style={place()}
        data-component="reaction-popover"
        onPointerEnter={props.onPointerEnter}
        onPointerLeave={() => {
          if (!full()) props.onPointerLeave()
        }}
      >
        <Show
          when={full()}
          fallback={
            <div class="grid grid-cols-7 rounded-xl bg-popover p-2 text-foreground shadow-popover" role="menu" aria-label="Reactions">
              <For each={recentEmoji().slice(0, QUICK)}>
                {(emoji) => (
                  <button
                    type="button"
                    role="menuitem"
                    class="grid size-10 cursor-default place-items-center rounded-md p-0 font-emoji text-[26px] leading-none hover:bg-[var(--accent-strong)] focus-visible:bg-[var(--accent-strong)] focus-visible:outline-none"
                    aria-label={`React with ${emoji}`}
                    data-emoji={emoji}
                    onClick={() => pick(emoji)}
                  >
                    {emoji}
                  </button>
                )}
              </For>
              <button
                type="button"
                role="menuitem"
                class="grid size-10 cursor-default place-items-center rounded-md p-0 text-[20px] leading-none font-semibold text-muted-foreground hover:bg-[var(--accent-strong)] hover:text-foreground focus-visible:bg-[var(--accent-strong)] focus-visible:outline-none"
                aria-label="More emoji"
                data-action="more-emoji"
                onClick={() => setFull(true)}
              >
                …
              </button>
            </div>
          }
        >
          <EmojiPicker onSelect={props.onPick} />
        </Show>
      </div>
    </Portal>
  )
}
