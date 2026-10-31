import type { BrowserEvent, ComputerFrame, TerminalEvent } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import { subscribe } from "../rpc/client"
import type { OwnerRuntimeServices } from "./runtime"

const FEED_ITEMS = 128
const FEED_CHARS = 512 * 1024
const DEFAULT_SIZE = { cols: 120, rows: 30 }
const BROWSER_ITEMS = 4

export type TerminalItem = { readonly seq: number; readonly event: TerminalEvent }
export type TerminalFeed = { readonly seq: number; readonly items: readonly TerminalItem[] }

export type BrowserItem = { readonly seq: number; readonly event: BrowserEvent }
export type BrowserFeed = { readonly seq: number; readonly items: readonly BrowserItem[] }
export type BrowserSize = { readonly maxWidth: number; readonly maxHeight: number }

const emptyFeed: TerminalFeed = { seq: 0, items: [] }
const emptyBrowserFeed: BrowserFeed = { seq: 0, items: [] }

const terminalSizes = new Map<string, { cols: number; rows: number }>()

export const terminalKey = (pcId: string, terminalId: string): string => `${pcId}\u0000${terminalId}`

export const browserKey = (pcId: string, tab: string, size: BrowserSize): string =>
  `${pcId}\u0000${tab}\u0000${Math.round(size.maxWidth)}x${Math.round(size.maxHeight)}`

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

function appendBrowser(feed: BrowserFeed, event: BrowserEvent): BrowserFeed {
  const seq = feed.seq + 1
  return { seq, items: [...feed.items, { seq, event }].slice(-BROWSER_ITEMS) }
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

  const browserAtom = Atom.family((key: string) => {
    const [pcId = "", tab = "", size = ""] = key.split("\u0000")
    const [maxWidth = 0, maxHeight = 0] = size.split("x").map(Number)
    return runtime
      .atom(
        subscribe("browser.live", () => Effect.succeed({ pcId, tab, maxWidth, maxHeight })).pipe(
          Stream.scan(() => emptyBrowserFeed, appendBrowser),
        ),
        { initialValue: emptyBrowserFeed },
      )
      .pipe(Atom.withLabel(`kiko-browser:${key}`))
  })

  return { framesAtom, terminalAtom, browserAtom }
}
