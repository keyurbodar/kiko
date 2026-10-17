import { EllipsisIcon, ReplyIcon, SmilePlusIcon } from "lucide-solid"
import { createSignal, lazy, onCleanup, onMount, Show, Suspense, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { warmEmoji } from "../../lib/emoji-data"
import { actionsPlacement, type ActionsPlacement } from "./actions-placement"

const popoverModule = () => import("./ReactionPopover")
const ReactionPopover = lazy(() => popoverModule().then((m) => ({ default: m.ReactionPopover })))

const OPEN_DELAY = 120
const CLOSE_DELAY = 200

const BUTTON = cn(
  "grid size-8 shrink-0 cursor-default place-items-center rounded-full p-0 text-muted-foreground",
  "hover:bg-[var(--accent-strong)] hover:text-foreground focus-visible:bg-[var(--accent-strong)] focus-visible:text-foreground",
  "data-[open]:bg-[var(--accent-strong)] data-[open]:text-foreground",
)

export function MessageActions(props: {
  side: "user" | "bot"
  onReact: (emoji: string) => void
  onReply: () => void
  onMore: (anchor: HTMLElement) => void
  /** Pixels beside the bubble that the run chevron takes. The actions sit past them. */
  reserve?: number
}): JSX.Element {
  let react: HTMLButtonElement | undefined
  const [open, setOpen] = createSignal(false)
  const [keyed, setKeyed] = createSignal(false)
  let openTimer: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  const clearTimers = () => {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
  }
  onCleanup(clearTimers)

  let root: HTMLDivElement | undefined
  const [placement, setPlacement] = createSignal<ActionsPlacement>("outside")
  onMount(() => {
    const bubble = root?.parentElement
    const row = root?.closest<HTMLElement>('[data-component="chat-row"]')
    if (!bubble || !row) return
    const measure = () => {
      if (open()) return
      const scroller = row.closest<HTMLElement>('[data-component="chat-scroll"]') ?? document.documentElement
      setPlacement(actionsPlacement(props.side, bubble.getBoundingClientRect(), scroller.getBoundingClientRect(), props.reserve ?? 0))
    }
    row.addEventListener("pointerenter", measure)
    row.addEventListener("focusin", measure)
    onCleanup(() => {
      row.removeEventListener("pointerenter", measure)
      row.removeEventListener("focusin", measure)
    })
  })

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
      ref={root}
      class={cn(
        "absolute z-[7] hidden items-center gap-0.5 pointer-fine:flex",
        "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 data-[open]:opacity-100",
        placement() === "inside"
          ? cn(
              "top-0 -translate-y-[80%] rounded-full border border-border bg-popover p-0.5 shadow-sm",
              props.side === "user" ? "right-2 flex-row-reverse" : "left-2",
            )
          : cn("top-1/2 -translate-y-1/2", props.side === "user" ? "right-full mr-1.5 flex-row-reverse" : "left-full ml-1.5"),
      )}
      style={props.reserve && placement() === "outside" ? { "margin-left": `${6 + props.reserve}px` } : undefined}
      data-component="chat-actions"
      data-placement={placement()}
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
        onClick={(event) => show(event.detail === 0)}
      >
        <SmilePlusIcon size={18} />
      </button>
      <button type="button" class={BUTTON} aria-label="Reply" data-action="reply" onClick={() => props.onReply()}>
        <ReplyIcon size={18} />
      </button>
      <button
        type="button"
        class={BUTTON}
        aria-label="More"
        data-action="more"
        onClick={(event) => props.onMore(event.currentTarget)}
      >
        <EllipsisIcon size={18} />
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
