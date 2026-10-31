import type { ComputerFrame, TerminalEvent } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import { subscribe } from "../rpc/client"
import type { OwnerRuntimeServices } from "./runtime"

const FEED_ITEMS = 128
const FEED_CHARS = 512 * 1024
const DEFAULT_SIZE = { cols: 120, rows: 30 }

export type TerminalItem = { readonly seq: number; readonly event: TerminalEvent }
export type TerminalFeed = { readonly seq: number; readonly items: readonly TerminalItem[] }

const emptyFeed: TerminalFeed = { seq: 0, items: [] }

const terminalSizes = new Map<string, { cols: number; rows: number }>()

export const terminalKey = (pcId: string, terminalId: string): string => `${pcId}\u0000${terminalId}`

export function setTerminalSize(key: string, cols: number, rows: number): void {
  terminalSizes.set(key, { cols, rows })
}

function eventChars(event: TerminalEvent): number {
  if (event.type === "output") return event.data.length
  if (event.type === "snapshot") return event.history.length
  return 0
}

function trim(items: readonly TerminalItem[]): readonly TerminalItem[] {
  let chars = 0
  let start = items.length
  while (start > 0) {
    const item = items[start - 1]
    if (!item) break
    const next = chars + eventChars(item.event)
    if (start < items.length && (items.length - start + 1 > FEED_ITEMS || next > FEED_CHARS)) break
    chars = next
    start -= 1
  }
  return start === 0 ? items : items.slice(start)
}

function append(feed: TerminalFeed, event: TerminalEvent): TerminalFeed {
  const seq = feed.seq + 1
  return { seq, items: trim([...feed.items, { seq, event }]) }
}

export function createComputerAtoms<E>(runtime: Atom.AtomRuntime<OwnerRuntimeServices, E>) {
  const framesAtom = Atom.family((pcId: string) =>
    runtime
      .atom(
        subscribe("pc.frames", () => Effect.succeed({ pcId })).pipe(
          Stream.map((frame) => Option.some<ComputerFrame>(frame)),
        ),
        { initialValue: Option.none<ComputerFrame>() },
      )
      .pipe(Atom.withLabel(`kiko-pc-frames:${pcId}`)),
  )

  const terminalAtom = Atom.family((key: string) => {
    const [pcId = "", terminalId = ""] = key.split("\u0000")
    const size = terminalSizes.get(key) ?? DEFAULT_SIZE
    return runtime
      .atom(
        subscribe("terminal.attach", () => Effect.succeed({ pcId, terminalId, cols: size.cols, rows: size.rows })).pipe(
          Stream.scan(() => emptyFeed, append),
        ),
        { initialValue: emptyFeed },
      )
      .pipe(Atom.withLabel(`kiko-terminal:${key}`))
  })

  return { framesAtom, terminalAtom }
}
