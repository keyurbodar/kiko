import type { BrowserEvent } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render, type Screen } from "../../../test/render"
import BrowserView from "./BrowserView"

type Feed = { seq: number; items: { seq: number; event: BrowserEvent }[] }

const fakes = vi.hoisted(() => ({
  feeds: [] as ((feed: Feed) => void)[],
  sent: [] as { command: string; input: Record<string, unknown> }[],
  pending: false,
}))

vi.mock("../computers", () => ({ takePending: () => fakes.pending }))

vi.mock("../../state/runtime", () => ({
  observe: (_atom: unknown, callback: (feed: Feed) => void) => {
    fakes.feeds.push(callback)
    queueMicrotask(() => callback({ seq: 0, items: [] }))
    return () => {}
  },
  valueOf: (value: unknown) => value,
  failureMessage: () => "",
  run: async (command: string, input: Record<string, unknown>) => {
    fakes.sent.push({ command, input })
    return { _tag: "Success", value: undefined }
  },
  owner: {
    commands: { browserInput: "browser.input", browserAck: "browser.ack" },
    browserAtom: (key: string) => key,
  },
}))

let feed: Feed = { seq: 0, items: [] }

const reset = () => {
  fakes.feeds = []
  fakes.sent = []
  fakes.pending = false
  feed = { seq: 0, items: [] }
}

const emit = (event: BrowserEvent) => {
  feed = { seq: feed.seq + 1, items: [...feed.items, { seq: feed.seq + 1, event }].slice(-4) }
  for (const callback of fakes.feeds) callback(feed)
}

const START: BrowserEvent = {
  type: "start",
  tab: "T1",
  width: 400,
  height: 250,
  viewportWidth: 1000,
  viewportHeight: 625,
}

function picture(color: string): string {
  const canvas = document.createElement("canvas")
  canvas.width = 8
  canvas.height = 5
  const context = canvas.getContext("2d")
  if (context) {
    context.fillStyle = color
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  return canvas.toDataURL("image/jpeg", 0.95).split(",")[1] ?? ""
}

const frame = (data: string, seq = 1): BrowserEvent => ({
  type: "frame",
  seq,
  tab: "T1",
  mime: "image/jpeg",
  width: 8,
  height: 5,
  viewportWidth: 1000,
  viewportHeight: 625,
  data,
})

const pixel = (screen: Screen): [number, number, number] => {
  const canvas = screen.container.querySelector("canvas") as HTMLCanvasElement
  const context = canvas.getContext("2d")
  const data = context?.getImageData(4, 2, 1, 1).data
  return [data?.[0] ?? 0, data?.[1] ?? 0, data?.[2] ?? 0]
}

const sentInputs = () => fakes.sent.filter((entry) => entry.command === "browser.input")
const acks = () => fakes.sent.filter((entry) => entry.command === "browser.ack").length
const stage = (screen: Screen) => screen.container.querySelector('[data-part="stage"]') as HTMLElement
const sink = (screen: Screen) => screen.container.querySelector('[data-part="sink"]') as HTMLTextAreaElement

async function mount(interactive: () => boolean) {
  const container = document.createElement("div")
  container.style.cssText = "width:800px;height:500px"
  reset()
  const screen = await render(() => <BrowserView pcId="pc-1" tab="T1" interactive={interactive()} />, { container })
  await expect.poll(() => fakes.feeds.length).toBeGreaterThan(0)
  return screen
}

describe("browser view", () => {
  it("paints the first frame the daemon sends once the owner attaches", async () => {
    await using screen = await mount(() => false)

    emit(START)
    emit(frame(picture("#ff0000")))

    await expect.poll(() => acks()).toBe(1)
    const [red, green, blue] = pixel(screen)
    expect(red).toBeGreaterThan(150)
    expect(green).toBeLessThan(90)
    expect(blue).toBeLessThan(90)
  })

  it("paints each live frame after the first", async () => {
    await using screen = await mount(() => false)

    emit(START)
    emit(frame(picture("#ff0000")))
    await expect.poll(() => acks()).toBe(1)

    emit(frame(picture("#0000ff"), 2))
    await expect.poll(() => acks()).toBe(2)
    const [red, , blue] = pixel(screen)
    expect(blue).toBeGreaterThan(150)
    expect(red).toBeLessThan(90)
  })

  it("sends nothing while watching, and a click reaches the page after the owner takes over", async () => {
    const [mine, setMine] = createSignal(false)
    await using screen = await mount(mine)
    emit(START)

    await userEvent.click(stage(screen))
    expect(sentInputs()).toEqual([])

    setMine(true)
    await userEvent.click(stage(screen))

    await expect.poll(() => sentInputs().length).toBe(1)
    const events = sentInputs().flatMap(
      (entry) => entry.input.events as { k: string; x?: number; y?: number; b?: number }[],
    )
    const down = events.find((event) => event.k === "down")
    expect(down?.b).toBe(0)
    expect(down?.x).toBeCloseTo(0.5, 1)
    expect(down?.y).toBeCloseTo(0.5, 1)
  })

  it("holds a click in the takeover gap and sends it once control lands", async () => {
    const [mine, setMine] = createSignal(false)
    await using screen = await mount(mine)
    emit(START)
    fakes.pending = true
    setMine(true)

    await userEvent.click(stage(screen))
    expect(sentInputs()).toEqual([])

    fakes.pending = false
    await expect.poll(() => sentInputs().length).toBe(1)
  })

  it("types into the page's focused input once the owner has control", async () => {
    await using screen = await mount(() => true)
    emit(START)
    sink(screen).focus()

    await userEvent.keyboard("hi")

    await expect.poll(() => sentInputs().length).toBe(1)
    const events = sentInputs().flatMap((entry) => entry.input.events as { k: string; key?: string; s?: string }[])
    expect(events.some((event) => event.k === "text" && event.s === "h")).toBe(true)
    expect(events.some((event) => event.k === "text" && event.s === "i")).toBe(true)
  })

  it("sends nothing more once the owner hands control back", async () => {
    const [mine, setMine] = createSignal(true)
    await using screen = await mount(mine)
    emit(START)

    await userEvent.click(stage(screen))
    await expect.poll(() => sentInputs().length).toBe(1)

    setMine(false)
    await userEvent.click(stage(screen))
    expect(sentInputs().length).toBe(1)
  })
})
