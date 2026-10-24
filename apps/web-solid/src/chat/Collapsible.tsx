import { makeResizeObserver } from "@solid-primitives/resize-observer"
import { ChevronDownIcon, ChevronUpIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import { foldLimitFor, shouldFold } from "./lib/fold"

const [expandedIds, setExpandedIds] = createSignal<ReadonlySet<string>>(new Set())

function isExpanded(messageId: string): boolean {
  return expandedIds().has(messageId)
}

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

export function Collapsible(props: { messageId: string; fixed?: boolean; children: JSX.Element }): JSX.Element {
  const [overflowing, setOverflowing] = createSignal(false)
  const [limit, setLimit] = createSignal(foldLimitFor(globalThis.innerHeight ?? 900))
  let root: HTMLDivElement | undefined
  let inner: HTMLDivElement | undefined
  let button: HTMLButtonElement | undefined
  let frame = 0

  const measure = () => {
    if (!inner) return
    const scroller = root ? scrollParent(root) : undefined
    const room = scroller?.clientHeight ?? globalThis.innerHeight ?? 900
    const next = foldLimitFor(room)
    setLimit(next)
    setOverflowing(shouldFold(inner.offsetHeight, next, props.fixed))
  }
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
    const onResize = () => scheduleMeasure()
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
    const target = expanding ? root : button
    const before = target.getBoundingClientRect().top
    setExpanded(props.messageId, expanding)
    if (!scroller) return
    const drift = target.getBoundingClientRect().top - before
    if (drift !== 0) scroller.scrollTop += drift
  }

  return (
    <div ref={root} class="relative" data-component="chat-collapsible" data-collapsed={clamped() ? "" : undefined}>
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
          class="mt-1 inline-flex cursor-pointer items-center gap-1 text-label text-fg3 transition-colors duration-(--dur-hover) hover:text-fg"
          aria-expanded={!clamped()}
          data-component="chat-collapsible-toggle"
          data-disclosure=""
          onClick={toggle}
        >
          {clamped() ? "Show more" : "Show less"}
          <RemixIcon icon={clamped() ? ChevronDownIcon : ChevronUpIcon} size={13} />
        </button>
      </Show>
    </div>
  )
}
