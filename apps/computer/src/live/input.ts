import type { Holder, InputEvent } from "@kiko/computer/wire"
import { platform, type Screen } from "./capture"
import type { Native } from "./native/contract"
import { linuxNative } from "./native/linux"
import { macNative } from "./native/macos"
import { place } from "./place"

const BUTTONS = new Map<number, number>([
  [0, 0],
  [1, 2],
  [2, 1],
])

export type Injected = {
  apply(events: readonly InputEvent[]): void
  chord(code: string, mods: number): void
  screen(): Screen | null
  release(): void
}

export type Gate = { holder(): Holder; allowed(): boolean }

function createNative(): Native | null {
  return platform() === "macos" ? macNative() : linuxNative()
}

export function createInput(area: () => Screen | null, gate: Gate, native = createNative()): Injected | null {
  if (!native) return null
  const bounds = () => area() ?? native.screen()
  const scale = (x: number, y: number) => place(area(), bounds(), x, y)

  return {
    apply(events) {
      if (!gate.allowed() || gate.holder() !== "human") return
      for (const event of events) {
        if (event.k === "cursor" || event.k === "paste") continue
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
    chord(code, mods) {
      if (!gate.allowed() || gate.holder() !== "human") return
      native.chord(code, mods)
    },
    screen() {
      return native.screen()
    },
    release() {
      native.release()
    },
  }
}
