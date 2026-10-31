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

const scrollParents = new WeakMap<HTMLElement, HTMLElement | null>()

function findScrollParent(element: HTMLElement): HTMLElement | undefined {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === "auto" || overflowY === "scroll") return node
  }
  return undefined
}

function scrollParent(element: HTMLElement): HTMLElement | undefined {
  if (!scrollParents.has(element)) scrollParents.set(element, findScrollParent(element) ?? null)
  return scrollParents.get(element) ?? undefined
}

const REVEAL_MS = 200

const CODE_BLOCK = '[data-component="chat-code-block"]'

const CODE_GAP = 8

function clampPastCode(inner: HTMLDivElement, limit: number): number {
  const blocks = inner.querySelectorAll<HTMLElement>(CODE_BLOCK)
  if (blocks.length === 0) return limit
  const top = inner.getBoundingClientRect().top
  let raised = limit
  for (const block of blocks) {
    const rect = block.getBoundingClientRect()
    if (rect.top - top >= raised || rect.bottom - top <= raised) continue
    raised = rect.bottom - top + CODE_GAP
  }
  return raised
}

function reveal(clip: HTMLDivElement | undefined, from: number): void {
  if (!clip || matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const to = clip.offsetHeight
  if (to <= from) return
  clip.style.overflow = "hidden"
  const done = () => (clip.style.overflow = "")
  clip
    .animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: REVEAL_MS,
      easing: "cubic-bezier(.2,.8,.2,1)",
    })
    .finished.then(done, done)
}

export function Collapsible(props: { messageId: string; fixed?: boolean; children: JSX.Element }): JSX.Element {
  const [overflowing, setOverflowing] = createSignal(false)
  const [limit, setLimit] = createSignal(foldLimitFor(globalThis.innerHeight ?? 900))
  const [maskFrom, setMaskFrom] = createSignal<number | null>(null)
  let root: HTMLDivElement | undefined
  let inner: HTMLDivElement | undefined
  let button: HTMLButtonElement | undefined
  let clip: HTMLDivElement | undefined
  let frame = 0

  const measure = () => {
    if (!inner) return
    const scroller = root ? scrollParent(root) : undefined
    const room = scroller?.clientHeight ?? globalThis.innerHeight ?? 900
    const base = foldLimitFor(room)
    const next = clampPastCode(inner, base)
    setLimit(next)
    setMaskFrom(next > base ? next - CODE_GAP : null)
    setOverflowing(shouldFold(inner.offsetHeight, base, props.fixed))
  }
  const scheduleMeasure = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      measure()
    })
  }
  onMount(() => {
    scheduleMeasure()
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

  const clipStyle = (): JSX.CSSProperties | undefined => {
    if (!clamped()) return undefined
    const from = maskFrom()
    const height = { "max-height": `${limit()}px` }
    if (from === null) return height
    const mask = `linear-gradient(to bottom, #000 ${from}px, transparent)`
    return { ...height, "mask-image": mask, "-webkit-mask-image": mask }
  }

  const toggle = () => {
    if (!root || !button) return
    const expanding = !isExpanded(props.messageId)
    const scroller = scrollParent(root)
    const target = expanding ? root : button
    const before = target.getBoundingClientRect().top
    const from = clip?.offsetHeight ?? 0
    setExpanded(props.messageId, expanding)
    if (expanding) reveal(clip, from)
    if (!scroller) return
    const drift = target.getBoundingClientRect().top - before
    if (drift !== 0) scroller.scrollTop += drift
  }

  return (
    <div ref={root} class="relative" data-component="chat-collapsible" data-collapsed={clamped() ? "" : undefined}>
      <div
        ref={clip}
        class={cn(
          clamped() && "overflow-hidden",
          clamped() && maskFrom() === null && "mask-b-from-[calc(100%-1.75rem)] mask-b-to-100%",
        )}
        style={clipStyle()}
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
          <RemixIcon icon={clamped() ? ChevronDownIcon : ChevronUpIcon} size={12} />
        </button>
      </Show>
    </div>
  )
}
