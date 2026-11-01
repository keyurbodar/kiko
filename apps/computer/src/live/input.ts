import type { Holder, InputEvent } from "@kiko/computer/wire"
import { platform, type Screen } from "./capture"
import type { Native } from "./native/contract"
import { linuxNative } from "./native/linux"
import { macNative } from "./native/macos"

const BUTTONS = new Map<number, number>([
  [0, 0],
  [1, 2],
  [2, 1],
])

export type Injected = {
  apply(events: readonly InputEvent[]): void
  screen(): Screen | null
  release(): void
}

export type Gate = { holder(): Holder; allowed(): boolean }

function createNative(): Native | null {
  return platform() === "macos" ? macNative() : linuxNative()
}

export function createInput(screen: Screen | null, gate: Gate): Injected | null {
  const native = createNative()
  if (!native) return null
  const area = screen ?? native.screen()
  const scale = (x: number, y: number): { x: number; y: number } => ({
    x: Math.round((area?.width ?? 1) * x) + (screen?.originX ?? 0),
    y: Math.round((area?.height ?? 1) * y) + (screen?.originY ?? 0),
  })

  return {
    apply(events) {
      if (!gate.allowed() || gate.holder() !== "human") return
      for (const event of events) {
        if (event.k === "cursor") continue
        if (event.k === "text") native.text(event.s)
        else if (event.k === "key") native.key(event.code, event.key, event.down)
        else if (event.k === "move") {
          const at = scale(event.x, event.y)
          native.move(at.x, at.y)
        } else if (event.k === "down" || event.k === "up") {
          const at = scale(event.x, event.y)
          native.button(BUTTONS.get(event.b) ?? 0, event.k === "down", at.x, at.y)
        } else {
          native.wheel(Math.round(event.dy), false)
          if (event.dx) native.wheel(Math.round(event.dx), true)
        }
      }
    },
    screen() {
      return native.screen()
    },
    release() {
      native.release()
    },
  }
}
