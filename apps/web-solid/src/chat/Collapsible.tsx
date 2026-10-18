import { makeResizeObserver } from "@solid-primitives/resize-observer"
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import { currentLimit, shouldFold } from "./lib/fold"

/**
 * "Show full message" for a long bubble.
 *
 * A body taller than the window's fold limit is clamped to that height, its
 * last lines faded out by a mask, with a text button under it. A mask rather than a
 * gradient in the bubble's colour: the bubble is translucent over the chat's
 * picture, so a painted fade let the text show through it. Toggling is instant: no
 * transition, no animation. The row's height changes in one frame, `virtua`
 * remeasures it through its own ResizeObserver, and the toggle moves the
 * scroller so the tapped bubble stays where the reader was looking.
 *
 * The expanded set lives at module level, so a row that unmounts when it
 * scrolls out of the virtual window comes back in the state it was left in.
 * It is a session cache: a reload starts everything clamped again.
 *
 * A `fixed` body, such as a photo, is never clamped and shows no button: the
 * picture owns the bubble's height, and clamping it cuts it apart.
 */



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
  /** A body whose height is the content's own, such as a photo: it is never clamped and shows no button. */
  fixed?: boolean
  children: JSX.Element
}): JSX.Element {
  const [overflowing, setOverflowing] = createSignal(false)
  const [limit, setLimit] = createSignal(currentLimit())
  let root: HTMLDivElement | undefined
  let inner: HTMLDivElement | undefined
  let button: HTMLButtonElement | undefined
  let frame = 0

  const measure = () => {
    if (!inner) return
    setOverflowing(shouldFold(inner.offsetHeight, limit(), props.fixed))
  }
  /**
   * The observer fires while the browser is still delivering layout. Writing the signal there
   * changes a row's height, which the virtualizer answers with another layout, and the browser
   * reports the loop. One frame later the write is outside the observer's own pass.
   */
  const scheduleMeasure = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      measure()
    })
  }
  onMount(() => {
    measure()
    if (!inner) return
    makeResizeObserver(scheduleMeasure).observe(inner)
    // A window resize changes the limit, and a body that fitted a tall window may not fit a short one.
    const onResize = () => {
      setLimit(currentLimit())
      scheduleMeasure()
    }
    window.addEventListener("resize", onResize)
    onCleanup(() => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(frame)
    })
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
        class={cn(clamped() && "overflow-hidden mask-b-from-[calc(100%-1.75rem)] mask-b-to-100%")}
        style={clamped() ? { "max-height": `${limit()}px` } : undefined}
      >
        <div ref={inner}>{props.children}</div>
      </div>
      <Show when={overflowing()}>
        <button
          ref={button}
          type="button"
          class="mt-1 cursor-pointer text-xs font-medium opacity-70 hover:opacity-100"
          aria-expanded={!clamped()}
          data-component="chat-collapsible-toggle"
          onClick={toggle}
        >
          {clamped() ? "Show full message" : "Show less"}
        </button>
      </Show>
    </div>
  )
}
