import { For, createSignal, onMount } from "solid-js"
import { displayShortcut } from "./hotkeys"
import { findCommand, isEnabled } from "./registry"

/*
 * The shortcut pills shown while the command key is held (see `hints.ts`). Each pill sits beside
 * the control that carries `data-hint`. The layer draws them hidden, measures their real sizes, and
 * then places them: whole pills on screen, and no pill over another (`place`). Nothing animates and
 * nothing here takes the pointer.
 */
export type Side = "bottom" | "top" | "left" | "right"
export type Box = { x: number; y: number; w: number; h: number }
type Pill = { key: string; label: string; keys: string; anchor: DOMRect; side: Side }

const GAP = 6
const EDGE = 8
/** Space kept between two pills. */
const SPACE = 4

/** A command title "Attach file…" reads as "Attach file" on a pill. */
export function pillLabel(title: string): string {
  return title.replace(/…$/, "")
}

/** Where a pill of size w x h goes beside `a` on `side`, before clamping. */
function beside(a: { left: number; top: number; right: number; bottom: number; width: number; height: number }, side: Side, w: number, h: number): Box {
  const cx = a.left + a.width / 2 - w / 2
  const cy = a.top + a.height / 2 - h / 2
  if (side === "top") return { x: cx, y: a.top - GAP - h, w, h }
  if (side === "left") return { x: a.left - GAP - w, y: cy, w, h }
  if (side === "right") return { x: a.right + GAP, y: cy, w, h }
  return { x: cx, y: a.bottom + GAP, w, h }
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w + SPACE && b.x < a.x + a.w + SPACE && a.y < b.y + b.h + SPACE && b.y < a.y + a.h + SPACE

const clamp = (box: Box, vw: number, vh: number): Box => ({
  ...box,
  x: Math.min(Math.max(box.x, EDGE), vw - EDGE - box.w),
  y: Math.min(Math.max(box.y, EDGE), vh - EDGE - box.h),
})

/**
 * Final boxes for pills wanted at `boxes` on `sides`, in order. Each is kept inside the viewport,
 * and one that lands on an earlier pill moves on, away from its control along its own side, until
 * it is clear. Pure, so the placement tests without a DOM.
 */
export function place(boxes: readonly Box[], sides: readonly Side[], vw: number, vh: number): Box[] {
  const placed: Box[] = []
  boxes.forEach((wanted, i) => {
    const side = sides[i] ?? "bottom"
    let box = clamp(wanted, vw, vh)
    for (let tries = 0; tries < 20; tries++) {
      const hit = placed.find((p) => overlaps(box, p))
      if (!hit) break
      const next =
        side === "right" ? { ...box, x: hit.x + hit.w + SPACE }
        : side === "left" ? { ...box, x: hit.x - SPACE - box.w }
        : side === "top" ? { ...box, y: hit.y - SPACE - box.h }
        : { ...box, y: hit.y + hit.h + SPACE }
      const clamped = clamp(next, vw, vh)
      // Pinned against an edge: step the other way along the free axis instead.
      box = clamped.x === box.x && clamped.y === box.y
        ? clamp(side === "left" || side === "right" ? { ...box, y: hit.y + hit.h + SPACE } : { ...box, x: hit.x + hit.w + SPACE }, vw, vh)
        : clamped
    }
    placed.push(box)
  })
  return placed
}

/**
 * Whether the reader can see the control now. A sidebar panel for another section stays mounted
 * with `visibility: hidden` to keep its scroll, so a size alone is not enough; and a control under
 * a dialog or a panel is covered, so the point at its centre has to be the control itself.
 */
function onScreen(el: HTMLElement, r: DOMRect): boolean {
  if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
  if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
  if (el.closest("[inert], [aria-hidden='true']")) return false
  const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1)
  const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1)
  const top = document.elementFromPoint(x, y)
  return !top || top === el || el.contains(top) || top.contains(el)
}

function collect(): Pill[] {
  const pills: Pill[] = []
  for (const el of document.querySelectorAll<HTMLElement>("[data-hint]")) {
    const command = findCommand(el.dataset.hint!)
    if (!command?.shortcut || !isEnabled(command)) continue
    const r = el.getBoundingClientRect()
    if (!onScreen(el, r)) continue
    pills.push({
      key: `${command.id}:${pills.length}`,
      label: el.dataset.hintLabel ?? pillLabel(command.title),
      keys: displayShortcut(command.shortcut).replace(/ /g, ""),
      anchor: r,
      side: (el.dataset.hintSide as Side | undefined) ?? "bottom",
    })
  }
  return pills
}

export default function HintLayer() {
  const pills = collect()
  const els: HTMLElement[] = []
  const [boxes, setBoxes] = createSignal<Box[] | null>(null)
  // Measured before the first paint, so the pills appear once, already in place.
  onMount(() => {
    const wanted = pills.map((p, i) => beside(p.anchor, p.side, els[i]!.offsetWidth, els[i]!.offsetHeight))
    setBoxes(place(wanted, pills.map((p) => p.side), innerWidth, innerHeight))
  })
  return (
    <div class="pointer-events-none fixed inset-0 z-[100]" data-component="shortcut-hints" aria-hidden="true">
      <For each={pills}>
        {(pill, i) => (
          <span
            ref={(el) => (els[i()] = el)}
            class="absolute top-0 left-0 flex h-6 items-center gap-1.5 rounded-[8px] bg-menu px-2 text-[12px] whitespace-nowrap text-text shadow-menu"
            style={{
              visibility: boxes() ? "visible" : "hidden",
              transform: boxes() ? `translate(${boxes()![i()]!.x}px, ${boxes()![i()]!.y}px)` : undefined,
            }}
          >
            {pill.label}
            <kbd class="rounded-[5px] bg-btn px-1 font-sans text-[11px] text-weak">{pill.keys}</kbd>
          </span>
        )}
      </For>
    </div>
  )
}
