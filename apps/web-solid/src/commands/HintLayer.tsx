import { For, createMemo } from "solid-js"
import { displayShortcut } from "./hotkeys"
import { findCommand, isEnabled } from "./registry"

/*
 * The shortcut pills shown while the command key is held (see `hints.ts`). Each pill sits beside
 * the control that carries `data-hint`, measured once when the layer appears; nothing animates and
 * nothing here takes the pointer.
 */
type Side = "bottom" | "top" | "left" | "right"
type Pill = { key: string; label: string; keys: string; x: number; y: number; side: Side }

const GAP = 6
const EDGE = 8

/** A command title "chat: attach file..." reads as "attach file" on a pill. */
export function pillLabel(title: string): string {
  const name = title.includes(": ") ? title.slice(title.indexOf(": ") + 2) : title
  return name.replace(/\.\.\.$/, "")
}

function measure(): Pill[] {
  const pills: Pill[] = []
  for (const el of document.querySelectorAll<HTMLElement>("[data-hint]")) {
    const command = findCommand(el.dataset.hint!)
    if (!command?.shortcut || !isEnabled(command)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
    const side = (el.dataset.hintSide as Side | undefined) ?? "bottom"
    const x = side === "left" ? r.left - GAP : side === "right" ? r.right + GAP : r.left + r.width / 2
    const y = side === "top" ? r.top - GAP : side === "bottom" ? r.bottom + GAP : r.top + r.height / 2
    pills.push({ key: `${command.id}:${pills.length}`, label: el.dataset.hintLabel ?? pillLabel(command.title), keys: displayShortcut(command.shortcut).replace(/ /g, ""), x, y, side })
  }
  return pills
}

const anchor: Record<Side, string> = {
  bottom: "translate(-50%, 0)",
  top: "translate(-50%, -100%)",
  left: "translate(-100%, -50%)",
  right: "translate(0, -50%)",
}

export default function HintLayer() {
  const pills = createMemo(measure)
  return (
    <div class="pointer-events-none fixed inset-0 z-[100]" data-component="shortcut-hints" aria-hidden="true">
      <For each={pills()}>
        {(pill) => (
          <span
            class="absolute flex h-6 items-center gap-1.5 rounded-[8px] bg-menu px-2 text-[12px] whitespace-nowrap text-text shadow-menu"
            style={{
              left: `${Math.min(Math.max(pill.x, EDGE), innerWidth - EDGE)}px`,
              top: `${Math.min(Math.max(pill.y, EDGE), innerHeight - EDGE)}px`,
              transform: anchor[pill.side],
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
