import { RemixIcon } from "@kiko/ui/remix-icon"
import { MoreIcon, ReactIcon, ReplyIcon } from "@kiko/ui/icons"
import { CopyCheckIcon } from "@kiko/ui/v2/copy-check-icon"
import { createSignal, onCleanup, onMount, Show, Suspense, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { warmEmoji } from "../../lib/emoji-data"
import { dividerParts } from "../lib/time-label"
import { fullTimeLabel } from "../run/duration"
import { actionsPlacement, type ActionsPlacement } from "./actions-placement"
import { ReactionPopover } from "./ReactionPopover"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"

const OPEN_DELAY = 120
const CLOSE_DELAY = 200
const TIME_RESERVE = 52

const BUTTON = cn(
  "grid size-control-md shrink-0 cursor-default place-items-center rounded-base p-0 text-secondary",
  "transition-[background-color,color,transform] duration-(--duration-instant) ease-sharp active:scale-(--press-scale)",
  "hover:bg-quaternary hover:text-primary focus-visible:bg-quaternary focus-visible:text-primary",
  "data-[open]:bg-quaternary data-[open]:text-primary",
)

const COPIED_MS = 1200

export function MessageActions(props: {
  side: "user" | "bot"
  onReact: (emoji: string) => void
  onReply: () => void
  onMore: (anchor: HTMLElement) => void
  reserve?: number
  copyText?: string
  sentAt?: number
}): JSX.Element {
  const [copied, setCopied] = createSignal(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(copyTimer))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.copyText ?? "")
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => setCopied(false), COPIED_MS)
  }
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
      setPlacement(
        actionsPlacement(
          props.side,
          bubble.getBoundingClientRect(),
          scroller.getBoundingClientRect(),
          (props.reserve ?? 0) + (props.sentAt === undefined ? 0 : TIME_RESERVE),
        ),
      )
    }
    row.addEventListener("pointerenter", measure)
    row.addEventListener("focusin", measure)
    onCleanup(() => {
      row.removeEventListener("pointerenter", measure)
      row.removeEventListener("focusin", measure)
    })
  })

  const warm = () => {
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
        "message-actions absolute z-[7] hidden items-center gap-1 pointer-fine:flex",
        "pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100",
        "focus-within:pointer-events-auto focus-within:opacity-100 data-[open]:pointer-events-auto data-[open]:opacity-100",
        placement() === "inside"
          ? cn("top-0 -translate-y-[80%]", props.side === "user" ? "right-1 flex-row-reverse" : "left-1")
          : cn(
              "top-1/2 -translate-y-1/2",
              props.side === "user" ? "right-full mr-1 flex-row-reverse" : "left-full ml-1",
            ),
      )}
      style={props.reserve && placement() === "outside" ? { "margin-left": `${4 + props.reserve}px` } : undefined}
      data-component="chat-actions"
      data-placement={placement()}
      data-open={open() ? "" : undefined}
    >
      <div
        class={cn(
          "flex items-center gap-px rounded-lg",
          placement() === "inside" && "bg-elevated p-0.5 shadow-(--popup-shadow)",
        )}
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
          <RemixIcon icon={ReactIcon} size={13} />
        </button>
        <button
          type="button"
          class={BUTTON}
          aria-label={copied() ? "Copied" : "Copy"}
          data-action="copy"
          data-copied={copied() ? "" : undefined}
          onClick={() => void copy()}
        >
          <CopyCheckIcon copied={copied()} size={13} class={copied() ? "text-success" : undefined} />
        </button>
        <button type="button" class={BUTTON} aria-label="Reply" data-action="reply" onClick={() => props.onReply()}>
          <RemixIcon icon={ReplyIcon} size={13} />
        </button>
        <button
          type="button"
          class={BUTTON}
          aria-label="More"
          data-action="more"
          onClick={(event) => props.onMore(event.currentTarget)}
        >
          <RemixIcon icon={MoreIcon} size={13} />
        </button>
      </div>
      <Show when={props.sentAt}>
        {(at) => (
          <TooltipV2 placement={props.side === "user" ? "left" : "right"} openDelay={0} value={fullTimeLabel(at())}>
            <span class="bubble-time" data-component="bubble-time">
              {dividerParts(at(), Date.now()).time}
            </span>
          </TooltipV2>
        )}
      </Show>
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
