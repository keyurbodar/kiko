import { RemixIcon } from "@kiko/ui/remix-icon"
import { MoreIcon, ReactIcon, ReplyIcon } from "@kiko/ui/icons"
import { CopyCheckIcon } from "@kiko/ui/v2/copy-check-icon"
import { createSignal, onCleanup, onMount, Show, Suspense, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { warmEmoji } from "../../lib/emoji-data"
import { actionsPlacement, type ActionsPlacement } from "./actions-placement"
import { ReactionPopover } from "./ReactionPopover"

const OPEN_DELAY = 120
const CLOSE_DELAY = 200

const BUTTON = cn(
  "grid size-7 shrink-0 cursor-default place-items-center rounded-full p-0 text-fg2",
  "transition-[background,color,transform] duration-[120ms] active:scale-95",
  "hover:bg-active hover:text-fg focus-visible:bg-active focus-visible:text-fg",
  "data-[open]:bg-active data-[open]:text-fg",
)

const COPIED_MS = 1200

export function MessageActions(props: {
  side: "user" | "bot"
  onReact: (emoji: string) => void
  onReply: () => void
  onMore: (anchor: HTMLElement) => void
  reserve?: number
  copyText?: string
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
          props.reserve ?? 0,
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
        "message-actions absolute z-[7] hidden items-center gap-0.5 pointer-fine:flex",
        "pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100",
        "focus-within:pointer-events-auto focus-within:opacity-100 data-[open]:pointer-events-auto data-[open]:opacity-100",
        "rounded-full bg-raise p-0.5 shadow-[0_6px_18px_rgb(0_0_0/0.28),inset_0_0_0_1px_var(--line)]",
        placement() === "inside"
          ? cn("top-0 -translate-y-[80%]", props.side === "user" ? "right-2 flex-row-reverse" : "left-2")
          : cn(
              "top-1/2 -translate-y-1/2",
              props.side === "user" ? "right-full mr-1.5 flex-row-reverse" : "left-full ml-1.5",
            ),
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
        <RemixIcon icon={ReactIcon} size={16} />
      </button>
      <button
        type="button"
        class={BUTTON}
        aria-label={copied() ? "Copied" : "Copy"}
        data-action="copy"
        data-copied={copied() ? "" : undefined}
        onClick={() => void copy()}
      >
        <CopyCheckIcon copied={copied()} size={16} class={copied() ? "text-ok" : undefined} />
      </button>
      <button type="button" class={BUTTON} aria-label="Reply" data-action="reply" onClick={() => props.onReply()}>
        <RemixIcon icon={ReplyIcon} size={16} />
      </button>
      <button
        type="button"
        class={BUTTON}
        aria-label="More"
        data-action="more"
        onClick={(event) => props.onMore(event.currentTarget)}
      >
        <RemixIcon icon={MoreIcon} size={16} />
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
