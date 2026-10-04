import { makeResizeObserver } from "@solid-primitives/resize-observer"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { createSignal, onMount, Show, type JSX } from "solid-js"
import { cn } from "../lib/cn"

/**
 * "Read more" for a long bubble.
 *
 * A body taller than `COLLAPSE_THRESHOLD_PX` is clamped to that height with a
 * fade into the bubble colour and a chevron. Toggling is instant: no
 * transition, no animation. The row's height changes in one frame, `virtua`
 * remeasures it through its own ResizeObserver, and the toggle moves the
 * scroller so the tapped bubble stays where the reader was looking.
 *
 * The expanded set lives at module level, so a row that unmounts when it
 * scrolls out of the virtual window comes back in the state it was left in.
 * It is a session cache: a reload starts everything clamped again.
 */

/** A body past this height is clamped. About 17 lines at the 14px type step. */
export const COLLAPSE_THRESHOLD_PX = 340
/** Content this close to the threshold is not worth hiding a line or two of. */
const SLACK_PX = 40

const [expandedIds, setExpandedIds] = createSignal<ReadonlySet<string>>(new Set())

export function isExpanded(messageId: string): boolean {
  return expandedIds().has(messageId)
}

/** The reader opens a few long messages, not hundreds. Past this the earliest opened folds again. */
const MAX_EXPANDED = 100

function setExpanded(messageId: string, value: boolean): void {
  const next = new Set(expandedIds())
  next.delete(messageId)
  if (value) next.add(messageId)
  if (next.size > MAX_EXPANDED) next.delete(next.values().next().value as string)
  setExpandedIds(next)
}

function scrollParent(element: HTMLElement): HTMLElement | undefined {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === "auto" || overflowY === "scroll") return node
  }
  return undefined
}

export function Collapsible(props: {
  messageId: string
  /** Which bubble colour the fade resolves to. */
  side: "user" | "assistant"
  children: JSX.Element
}): JSX.Element {
  const [overflowing, setOverflowing] = createSignal(false)
  let root: HTMLDivElement | undefined
  let inner: HTMLDivElement | undefined
  let button: HTMLButtonElement | undefined

  const measure = () => {
    if (!inner) return
    setOverflowing(inner.offsetHeight > COLLAPSE_THRESHOLD_PX + SLACK_PX)
  }
  onMount(() => {
    measure()
    if (!inner) return
    makeResizeObserver(measure).observe(inner)
  })

  const clamped = () => overflowing() && !isExpanded(props.messageId)

  const toggle = () => {
    if (!root || !button) return
    const expanding = !isExpanded(props.messageId)
    const scroller = scrollParent(root)
    // Expanding keeps the bubble's top still, so the text grows downward.
    // Collapsing keeps the chevron still, because the bubble's top may be off
    // screen and the reader's eye is on the control they tapped.
    const target = expanding ? root : button
    const before = target.getBoundingClientRect().top
    setExpanded(props.messageId, expanding)
    if (!scroller) return
    const drift = target.getBoundingClientRect().top - before
    if (drift !== 0) scroller.scrollTop += drift
  }

  return (
    <div
      ref={root}
      class="relative"
      data-component="chat-collapsible"
      data-collapsed={clamped() ? "" : undefined}
    >
      <div
        class={cn(clamped() && "overflow-hidden")}
        style={clamped() ? { "max-height": `${COLLAPSE_THRESHOLD_PX}px` } : undefined}
      >
        <div ref={inner}>{props.children}</div>
      </div>
      <Show when={overflowing()}>
        <Show when={clamped()}>
          <div
            aria-hidden="true"
            class={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-b from-transparent",
              props.side === "user" ? "to-message-user" : "to-message-assistant",
            )}
            data-component="chat-collapsible-fade"
          />
        </Show>
        <button
          ref={button}
          type="button"
          class={cn(
            "flex h-6 w-full cursor-pointer items-center justify-center opacity-70 hover:opacity-100",
            clamped() ? "absolute inset-x-0 bottom-0" : "mt-1",
          )}
          aria-expanded={!clamped()}
          aria-label={clamped() ? "read more" : "show less"}
          data-component="chat-collapsible-toggle"
          onClick={toggle}
        >
          <HugeIcon name="chevron-down" class={cn("size-4", !clamped() && "rotate-180")} aria-hidden="true" />
        </button>
      </Show>
    </div>
  )
}
