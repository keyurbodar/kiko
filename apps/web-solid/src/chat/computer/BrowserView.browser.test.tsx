import { encodeBrowserFrame } from "@kiko/computer/frame"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render, type Screen } from "../../../test/render"
import BrowserView from "./BrowserView"

const fakes = vi.hoisted(() => ({
  sent: [] as { command: string; input: Record<string, unknown> }[],
  frame: 0,
  setPending: (_pending: boolean) => {},
}))

vi.mock("../computers", async () => {
  const { createSignal } = await import("solid-js")
  const [pending, setPending] = createSignal(false)
  fakes.setPending = setPending
  return { takePending: () => pending() }
})

vi.mock("../../state/runtime", () => ({
  liveSocket: () => ({ url: "ws://live/pc-1", protocols: ["kiko"] }),
  run: async (command: string, input: Record<string, unknown>) => {
    fakes.sent.push({ command, input })
    return { _tag: "Success", value: undefined }
  },
  owner: { commands: { browserInput: "browser.input" } },
}))

class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readonly sent: string[] = []
  readyState = 1
  binaryType = "blob"
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    FakeSocket.all.push(this)
    queueMicrotask(() => this.emit("open"))
  }

  addEventListener(type: string, handler: (event: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.emit("close")
  }

  emit(type: string, event: { data?: unknown } = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  pushJson(value: unknown) {
    this.emit("message", { data: JSON.stringify(value) })
  }

  pushFrame(bytes: Uint8Array<ArrayBuffer>) {
    this.emit("message", { data: bytes.buffer })
  }

  json(): { t?: string; on?: boolean; id?: string; tab?: string }[] {
    return this.sent.flatMap((text) => {
      try {
        return [JSON.parse(text) as { t?: string; on?: boolean; id?: string; tab?: string }]
      } catch {
        return []
      }
    })
  }
}

const socket = () => FakeSocket.all.at(-1) as FakeSocket

function picture(color: string): Uint8Array<ArrayBuffer> {
  const canvas = document.createElement("canvas")
  canvas.width = 8
  canvas.height = 5
  const context = canvas.getContext("2d")
  if (context) {
    context.fillStyle = color
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  fakes.frame += 1
  return new Uint8Array(
    encodeBrowserFrame(
      { id: "a", tab: "T1", seq: fakes.frame, width: 8, height: 5, viewportWidth: 1000, viewportHeight: 625 },
      jpegBytes(canvas),
    ),
  )
}

function jpegBytes(canvas: HTMLCanvasElement): Uint8Array {
  const raw = atob(canvas.toDataURL("image/jpeg", 0.95).split(",")[1] ?? "")
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

const pixel = (screen: Screen): [number, number, number] => {
  const canvas = screen.container.querySelector("canvas") as HTMLCanvasElement
  const context = canvas.getContext("2d")
  const data = context?.getImageData(4, 2, 1, 1).data
  return [data?.[0] ?? 0, data?.[1] ?? 0, data?.[2] ?? 0]
}

const sentInputs = () => fakes.sent.filter((entry) => entry.command === "browser.input")
const allEvents = () =>
  sentInputs().flatMap(
    (entry) =>
      entry.input.events as {
        k: string
        x?: number
        y?: number
        b?: number
        s?: string
        key?: string
        down?: boolean
      }[],
  )
const acks = () =>
  socket()
    .json()
    .filter((message) => message.t === "browserAck").length
const stage = (screen: Screen) => screen.container.querySelector('[data-part="stage"]') as HTMLElement
const sink = (screen: Screen) => screen.container.querySelector('[data-part="sink"]') as HTMLTextAreaElement

async function mount(interactive: () => boolean) {
  const container = document.createElement("div")
  container.style.cssText = "width:320px;height:200px"
  fakes.sent = []
  fakes.frame = 0
  fakes.setPending(false)
  FakeSocket.all = []
  const screen = await render(() => <BrowserView pcId="pc-1" tab="T1" interactive={interactive()} />, { container })
  await expect
    .poll(() =>
      socket()
        ?.json()
        .some((message) => message.t === "browser"),
    )
    .toBe(true)
  return screen
}

function stubbed(): Disposable {
  vi.stubGlobal("WebSocket", FakeSocket)
  return { [Symbol.dispose]: () => vi.unstubAllGlobals() }
}

describe("browser view", () => {
  it("attaches to one tab and paints the first frame the daemon sends", async () => {
    using _stubs = stubbed()
    await using screen = await mount(() => false)

    expect(socket().json()[0]).toMatchObject({ t: "browser", on: true, tab: "T1" })
    socket().pushJson({ t: "browser", event: { type: "start", tab: "T1" } })
    socket().pushFrame(picture("#ff0000"))

    await expect.poll(() => acks()).toBe(1)
    const [red, green, blue] = pixel(screen)
    expect(red).toBeGreaterThan(150)
    expect(green).toBeLessThan(90)
    expect(blue).toBeLessThan(90)
  })

  it("paints each live frame after the first", async () => {
    using _stubs = stubbed()
    await using screen = await mount(() => false)

    socket().pushJson({ t: "browser", event: { type: "start", tab: "T1" } })
    socket().pushFrame(picture("#ff0000"))
    await expect.poll(() => acks()).toBe(1)

    socket().pushFrame(picture("#0000ff"))
    await expect.poll(() => acks()).toBe(2)
    const [red, , blue] = pixel(screen)
    expect(blue).toBeGreaterThan(150)
    expect(red).toBeLessThan(90)
  })

  it("sends nothing while watching, and a click reaches the page after the owner takes over", async () => {
    using _stubs = stubbed()
    const [mine, setMine] = createSignal(false)
    await using screen = await mount(mine)

    await userEvent.click(stage(screen))
    expect(sentInputs()).toEqual([])

    setMine(true)
    await userEvent.click(stage(screen))

    await expect.poll(() => allEvents().some((event) => event.k === "down")).toBe(true)
    const down = allEvents().find((event) => event.k === "down")
    expect(down?.b).toBe(0)
    expect(down?.x).toBeCloseTo(0.5, 1)
    expect(down?.y).toBeCloseTo(0.5, 1)
  })

  it("holds a click in the takeover gap and sends it once control lands", async () => {
    using _stubs = stubbed()
    const [mine, setMine] = createSignal(false)
    await using screen = await mount(mine)
    fakes.setPending(true)
    setMine(true)

    await userEvent.click(stage(screen))
    expect(sentInputs()).toEqual([])

    fakes.setPending(false)
    await expect.poll(() => allEvents().some((event) => event.k === "down")).toBe(true)
  })

  it("types into the page's focused input once the owner has control", async () => {
    using _stubs = stubbed()
    await using screen = await mount(() => true)
    sink(screen).focus()

    await userEvent.keyboard("hi")

    await expect.poll(() => allEvents().some((event) => event.k === "key" && event.key === "i")).toBe(true)
    expect(allEvents().some((event) => event.k === "key" && event.key === "h" && event.down)).toBe(true)
  })

  it("sends nothing more once the owner hands control back", async () => {
    using _stubs = stubbed()
    const [mine, setMine] = createSignal(true)
    await using screen = await mount(mine)

    await userEvent.click(stage(screen))
    await expect.poll(() => allEvents().some((event) => event.k === "down")).toBe(true)

    setMine(false)
    const before = sentInputs().length
    await userEvent.click(stage(screen))
    expect(sentInputs().length).toBe(before)
  })
})
