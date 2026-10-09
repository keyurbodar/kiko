import { HugeIcon } from "@yuki/ui/huge-icon"
import { HeartAddIcon, MoreIcon, ReplyIcon } from "@yuki/ui/icons"
import { createSignal, lazy, onCleanup, Show, Suspense, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { warmEmoji } from "../../lib/emoji-data"

/* The popover and its picker load on the first hover of a react button. */
const popoverModule = () => import("./ReactionPopover")
const ReactionPopover = lazy(() => popoverModule().then((m) => ({ default: m.ReactionPopover })))

/** Hover this long on the react button before the popover opens. */
const OPEN_DELAY = 120
/** The pointer has this long to cross from the button into the popover. */
const CLOSE_DELAY = 200

const BUTTON = cn(
  "grid size-8 shrink-0 cursor-default place-items-center rounded-full p-0 text-muted",
  "hover:bg-[var(--selected-bg)] hover:text-text focus-visible:bg-[var(--selected-bg)] focus-visible:text-text",
  "data-[open]:bg-[var(--selected-bg)] data-[open]:text-text",
)

/**
 * React, reply and more, beside a bubble while the pointer is over its row or
 * the row holds keyboard focus. Pointer devices only: touch keeps the long
 * press menu. They sit right of an agent's bubble and left of the human's.
 */
export function MessageActions(props: {
  side: "user" | "bot"
  onReact: (emoji: string) => void
  onReply: () => void
  onMore: (anchor: HTMLElement) => void
}): JSX.Element {
  let react: HTMLButtonElement | undefined
  const [open, setOpen] = createSignal(false)
  /** Opened from the keyboard: the popover takes focus. */
  const [keyed, setKeyed] = createSignal(false)
  let openTimer: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  const clearTimers = () => {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
  }
  onCleanup(clearTimers)

  const warm = () => {
    void popoverModule()
    warmEmoji()
  }
  const show = (fromKeyboard = false) => {
    clearTimers()
    warm()
    setKeyed(fromKeyboard)
    setOpen(true)
  }
  const hold = () => clearTimeout(closeTimer)
  const leave = () => {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => setOpen(false), CLOSE_DELAY)
  }

  return (
    <div
      class={cn(
        "absolute top-1/2 z-[7] hidden -translate-y-1/2 items-center gap-0.5 pointer-fine:flex",
        "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 data-[open]:opacity-100",
        props.side === "user" ? "right-full mr-1.5 flex-row-reverse" : "left-full ml-1.5",
      )}
      data-component="chat-actions"
      data-open={open() ? "" : undefined}
    >
      <button
        ref={react}
        type="button"
        class={BUTTON}
        aria-label="React"
        aria-haspopup="dialog"
        aria-expanded={open()}
        data-action="react"
        data-open={open() ? "" : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return
          warm()
          hold()
          if (!open()) openTimer = setTimeout(() => show(), OPEN_DELAY)
        }}
        onPointerLeave={() => {
          if (open()) leave()
          else clearTimeout(openTimer)
        }}
        // A click from Enter or Space has no pointer, so its detail is 0.
        onClick={(event) => show(event.detail === 0)}
      >
        <HugeIcon icon={HeartAddIcon} size={18} />
      </button>
      <button type="button" class={BUTTON} aria-label="Reply" data-action="reply" onClick={() => props.onReply()}>
        <HugeIcon icon={ReplyIcon} size={18} />
      </button>
      <button
        type="button"
        class={BUTTON}
        aria-label="More"
        data-action="more"
        onClick={(event) => props.onMore(event.currentTarget)}
      >
        <HugeIcon icon={MoreIcon} size={18} />
      </button>
      <Show when={open() && react}>
        {(anchor) => (
          <Suspense>
            <ReactionPopover
              anchor={anchor()}
              focus={keyed()}
              onPointerEnter={hold}
              onPointerLeave={leave}
              onPick={(emoji) => {
                setOpen(false)
                props.onReact(emoji)
              }}
              onClose={() => {
                clearTimers()
                setOpen(false)
              }}
            />
          </Suspense>
        )}
      </Show>
    </div>
  )
}
