import { makeResizeObserver } from "@solid-primitives/resize-observer"
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { cn } from "../lib/cn"

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

/**
 * How tall a bubble may grow before it folds.
 *
 * A fixed 180 px folded almost every real answer: four lines on a wide desktop bubble, two on a
 * phone. The limit is a share of the window instead, so a medium message is simply shown, and only
 * one that would push the next message off screen is folded. A phone gets a taller share because
 * its column is narrow, so the same words take more lines.
 */
export function collapseLimit(viewportHeight: number, coarse: boolean): number {
  const share = coarse ? 0.85 : 0.72
  return Math.round(Math.max(coarse ? 360 : 480, Math.min(coarse ? 760 : 900, viewportHeight * share)))
}

/**
 * Content is folded only when it is over the limit by a quarter. A message that hides two lines
 * behind a "Show full message" button costs more than it saves, so it is shown whole.
 */
export const FOLD_SLACK = 0.25

export function shouldFold(contentHeight: number, limit: number, fixed = false): boolean {
  return !fixed && contentHeight > limit * (1 + FOLD_SLACK)
}

/** The limit for this window right now. */
function currentLimit(): number {
  const coarse = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false
  return collapseLimit(globalThis.innerHeight ?? 900, coarse)
}

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

  const measure = () => {
    if (!inner) return
    setOverflowing(shouldFold(inner.offsetHeight, limit(), props.fixed))
  }
  onMount(() => {
    measure()
    if (!inner) return
    makeResizeObserver(measure).observe(inner)
    // A window resize changes the limit, and a body that fitted a tall window may not fit a short one.
    const onResize = () => {
      setLimit(currentLimit())
      measure()
    }
    window.addEventListener("resize", onResize)
    onCleanup(() => window.removeEventListener("resize", onResize))
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
