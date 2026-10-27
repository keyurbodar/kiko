import { For, Show, createSignal, onMount } from "solid-js"
import { displayShortcut } from "./hotkeys"
import { isCommandId } from "./ids"
import { findCommand, isEnabled, shortcutOf } from "./registry"
import { paletteStack } from "../palette/state"

export type Side = "bottom" | "top" | "left" | "right"
export type Box = { x: number; y: number; w: number; h: number }
type Pill = { key: string; label: string; keys: string; anchor: DOMRect; side: Side }

const GAP = 6
const EDGE = 8
const SPACE = 4

function pillLabel(title: string): string {
  return title.replace(/…$/, "")
}

function beside(
  a: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  side: Side,
  w: number,
  h: number,
): Box {
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

function place(boxes: readonly Box[], sides: readonly Side[], vw: number, vh: number): Box[] {
  const placed: Box[] = []
  boxes.forEach((wanted, i) => {
    const side = sides[i] ?? "bottom"
    let box = clamp(wanted, vw, vh)
    for (let tries = 0; tries < 20; tries++) {
      const hit = placed.find((p) => overlaps(box, p))
      if (!hit) break
      const next =
        side === "right"
          ? { ...box, x: hit.x + hit.w + SPACE }
          : side === "left"
            ? { ...box, x: hit.x - SPACE - box.w }
            : side === "top"
              ? { ...box, y: hit.y - SPACE - box.h }
              : { ...box, y: hit.y + hit.h + SPACE }
      const clamped = clamp(next, vw, vh)
      box =
        clamped.x === box.x && clamped.y === box.y
          ? clamp(
              side === "left" || side === "right"
                ? { ...box, y: hit.y + hit.h + SPACE }
                : { ...box, x: hit.x + hit.w + SPACE },
              vw,
              vh,
            )
          : clamped
    }
    placed.push(box)
  })
  return placed
}

function onScreen(el: HTMLElement, r: DOMRect): boolean {
  if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)
    return false
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
    const id = el.dataset.hint
    const command = isCommandId(id) ? findCommand(id) : undefined
    const shortcut = command && shortcutOf(command)
    if (!shortcut || !isEnabled(command)) continue
    const r = el.getBoundingClientRect()
    if (!onScreen(el, r)) continue
    pills.push({
      key: `${command.id}:${pills.length}`,
      label: el.dataset.hintLabel ?? pillLabel(command.title),
      keys: displayShortcut(shortcut).replace(/ /g, ""),
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
  onMount(() => {
    const wanted = pills.map((p, i) => beside(p.anchor, p.side, els[i]!.offsetWidth, els[i]!.offsetHeight))
    setBoxes(
      place(
        wanted,
        pills.map((p) => p.side),
        innerWidth,
        innerHeight,
      ),
    )
  })
  return (
    <Show when={paletteStack() === null}>
      <div class="pointer-events-none fixed inset-0 z-[100]" data-component="shortcut-hints" aria-hidden="true">
        <For each={pills}>
          {(pill, i) => (
            <span
              ref={(el) => (els[i()] = el)}
              class="absolute top-0 left-0 flex h-6 items-center gap-1.5 rounded-control bg-raise px-2 text-hint whitespace-nowrap text-fg shadow-menu"
              style={{
                visibility: boxes() ? "visible" : "hidden",
                transform: boxes() ? `translate(${boxes()![i()]!.x}px, ${boxes()![i()]!.y}px)` : undefined,
              }}
            >
              {pill.label}
              <kbd class="rounded-check bg-active px-1 font-sans text-hint text-fg2">{pill.keys}</kbd>
            </span>
          )}
        </For>
      </div>
    </Show>
  )
}
