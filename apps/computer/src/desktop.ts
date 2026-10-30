import { setTimeout as sleep } from "node:timers/promises"
import type { Args, Step, Value } from "@kiko/computer/wire"
import type { Area, Backend, Shot } from "./desk/backend"
import { parseKeys } from "./desk/keys"
import { Fail } from "./log"
import { InputQueue } from "./queue"
import type { Deadline } from "./deadline"

const LONG_EDGE = 1280
const JPEG_QUALITY = 80
const FRAMES = 4
const SETTLE_MS = 350
const DRAG_STEPS = 12
const DRAG_STEP_MS = 8
const MIN_WHEEL_PIXELS = 50
const HOVER_MS = 40
const PRESS_MS = 30
const FOCUS_MS = 120
const STEP_GAP_MS = 60

const BUTTONS = { left: 0, right: 1, middle: 2 } as const

type Frame = { id: string; area: Area; width: number; height: number }

export type Encoded = { data: string; width: number; height: number }
export type Codec = (bytes: Uint8Array<ArrayBuffer>, limit: number) => Promise<Encoded>

type Captured = { frame: Frame; image: Encoded }

type Zoom = NonNullable<Args<"look">["zoom"]>

type Placed = { image: { x: number; y: number }; native: { x: number; y: number } }

export function fitInside(width: number, height: number, limit: number): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  const scale = longEdge > limit ? limit / longEdge : 1
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const encodeJpeg: Codec = async (bytes, limit) => {
  const meta = await new Bun.Image(bytes).metadata()
  const size = fitInside(meta.width, meta.height, limit)
  const pipeline = new Bun.Image(bytes)
  if (size.width !== meta.width || size.height !== meta.height) pipeline.resize(size.width, size.height)
  const out = await pipeline.jpeg({ quality: JPEG_QUALITY }).bytes()
  const final = await new Bun.Image(out).metadata()
  return { data: Buffer.from(out).toString("base64"), width: final.width, height: final.height }
}

export class Desktop {
  readonly queue = new InputQueue()
  pointer: ((x: number, y: number) => void) | null = null
  private frames: Frame[] = []
  private current: Frame | null = null
  private screen = false

  constructor(
    private readonly backend: Backend,
    private readonly codec: Codec = encodeJpeg,
  ) {}

  async look(args: Args<"look">, deadline: Deadline): Promise<Value<"look">> {
    if (args.zoom) return this.zoom(args.zoom, deadline)
    const shot = await this.capture(args, deadline)
    const image = args.image === false ? {} : { image: { mime: "image/jpeg" as const, data: shot.image.data } }
    return {
      captureId: shot.frame.id,
      width: shot.frame.width,
      height: shot.frame.height,
      controls: [],
      ...image,
    }
  }

  private async zoom(zoom: Zoom, deadline: Deadline): Promise<Value<"look">> {
    const frame = await this.resolve(zoom.captureId, deadline)
    this.requireScreen()
    const region = regionOf(frame, zoom)
    if (!region) throw new Fail({ code: "failed", message: "the zoom box is outside the screenshot" })
    const shot = await this.backend.shoot(region, deadline.signal)
    const image = await this.codec(shot.bytes, LONG_EDGE)
    return {
      captureId: frame.id,
      width: frame.width,
      height: frame.height,
      controls: [],
      image: { mime: "image/jpeg", data: image.data },
    }
  }

  async act(args: Args<"act">, deadline: Deadline): Promise<Value<"act">> {
    const frame = await this.resolve(args.captureId, deadline)
    this.requireInput()
    let done = 0
    let error: string | undefined
    for (const step of args.steps) {
      if (deadline.signal.aborted) throw new Fail({ code: "cancelled", message: "the call was cancelled" })
      const failed = await this.queue
        .run(
          () => this.step(frame, step, deadline),
          async () => this.backend.native.release(),
        )
        .then(
          () => undefined,
          (cause: unknown) => stepFailure(cause, deadline),
        )
      if (failed !== undefined) {
        error = failed
        break
      }
      done += 1
      if (done < args.steps.length) await sleep(STEP_GAP_MS)
    }
    await sleep(SETTLE_MS)
    const view = await this.look({ image: args.image }, deadline.child(10_000))
    return error === undefined ? { done, view } : { done, error, view }
  }

  private async step(frame: Frame, step: Step, deadline: Deadline): Promise<void> {
    if (deadline.signal.aborted) throw new Fail({ code: "cancelled", message: "the call was cancelled" })
    this.showPointer(frame, step)
    if (step.op === "wait") return this.wait(step.ms, deadline)
    if (step.op === "key") return this.keys(step.keys)
    if (step.op === "open") return this.backend.open(step.app, deadline.signal)
    if (step.op === "type") return this.type(frame, step)
    if (step.op === "click") return this.click(frame, step)
    if (step.op === "drag") return this.drag(frame, step)
    if (step.op === "scroll") return this.scroll(frame, step)
    return this.moveTo(this.inputPoint(frame, step.x, step.y))
  }

  private async click(frame: Frame, step: Extract<Step, { op: "click" }>): Promise<void> {
    if (step.id !== undefined)
      throw new Fail({ code: "failed", message: "element ids are not supported; click by x,y" })
    const at = this.place(frame, step.x, step.y)
    await this.press(at.native, BUTTONS[step.button ?? "left"], step.count ?? 1)
  }

  private async type(frame: Frame, step: Extract<Step, { op: "type" }>): Promise<void> {
    if (step.x !== undefined && step.y !== undefined) {
      await this.press(this.place(frame, step.x, step.y).native, BUTTONS.left, 1)
      await sleep(FOCUS_MS)
    }
    this.backend.native.text(step.text)
    if (step.submit) this.keys("enter")
  }

  private keys(keys: string): void {
    for (const chord of parseKeys(keys)) {
      for (const mod of chord.mods) this.backend.native.key(mod, mod, true)
      this.backend.native.key(chord.code, chord.key, true)
      this.backend.native.key(chord.code, chord.key, false)
      for (const mod of chord.mods.toReversed()) this.backend.native.key(mod, mod, false)
    }
  }

  private async scroll(frame: Frame, step: Extract<Step, { op: "scroll" }>): Promise<void> {
    if (step.x !== undefined && step.y !== undefined) {
      this.moveTo(this.inputPoint(frame, step.x, step.y))
      await sleep(HOVER_MS)
    }
    if (step.dy !== 0) this.backend.native.wheel(wheelPixels((step.dy * frame.area.height) / frame.height), false)
    if (step.dx !== 0) this.backend.native.wheel(wheelPixels((step.dx * frame.area.width) / frame.width), true)
  }

  private async drag(frame: Frame, step: Extract<Step, { op: "drag" }>): Promise<void> {
    const from = this.inputPoint(frame, step.from[0], step.from[1])
    const to = this.inputPoint(frame, step.to[0], step.to[1])
    const native = this.backend.native
    native.move(from.x, from.y)
    native.button(BUTTONS.left, true, from.x, from.y)
    for (let index = 1; index <= DRAG_STEPS; index += 1) {
      await sleep(DRAG_STEP_MS)
      native.move(
        Math.round(from.x + ((to.x - from.x) * index) / DRAG_STEPS),
        Math.round(from.y + ((to.y - from.y) * index) / DRAG_STEPS),
      )
    }
    native.button(BUTTONS.left, false, to.x, to.y)
  }

  private async wait(ms: number, deadline: Deadline): Promise<void> {
    await sleep(Math.min(ms, Math.max(0, deadline.remaining() - 500)))
  }

  private async press(at: { x: number; y: number }, slot: number, count: number): Promise<void> {
    this.moveTo(at)
    await sleep(HOVER_MS)
    for (let index = 0; index < count; index += 1) {
      this.backend.native.button(slot, true, at.x, at.y)
      await sleep(PRESS_MS)
      this.backend.native.button(slot, false, at.x, at.y)
    }
  }

  private moveTo(at: { x: number; y: number }): void {
    this.backend.native.move(at.x, at.y)
  }

  private place(frame: Frame, x: number | undefined, y: number | undefined): Placed {
    if (x !== undefined && y !== undefined) return { image: { x, y }, native: this.inputPoint(frame, x, y) }
    const cursor = this.backend.native.cursor()
    if (!cursor) throw new Fail({ code: "failed", message: "there is no cursor to click; give x and y" })
    return { native: cursor, image: this.imagePoint(frame, cursor) }
  }

  private inputPoint(frame: Frame, x: number, y: number): { x: number; y: number } {
    return {
      x: Math.round(frame.area.originX + (x * frame.area.width) / frame.width),
      y: Math.round(frame.area.originY + (y * frame.area.height) / frame.height),
    }
  }

  private imagePoint(frame: Frame, at: { x: number; y: number }): { x: number; y: number } {
    return {
      x: ((at.x - frame.area.originX) * frame.width) / frame.area.width,
      y: ((at.y - frame.area.originY) * frame.height) / frame.area.height,
    }
  }

  private showPointer(frame: Frame, step: Step): void {
    if (!this.pointer) return
    const at = targetOf(step)
    if (at) this.pointer(at.x / frame.width, at.y / frame.height)
  }

  private async resolve(captureId: string | undefined, deadline: Deadline): Promise<Frame> {
    if (captureId) {
      const found = this.frames.find((frame) => frame.id === captureId)
      if (!found) throw new Fail({ code: "stale", message: "that screenshot is gone; call computer_look again" })
      return found
    }
    if (this.current) return this.current
    await this.look({ image: false }, deadline)
    if (!this.current) throw new Fail({ code: "stale", message: "that screenshot is gone; call computer_look again" })
    return this.current
  }

  private requireInput(): void {
    if (this.backend.access().input) return
    throw new Fail({ code: "denied", message: inputDenied() })
  }

  private requireScreen(): void {
    if (this.screen) return
    if (this.backend.access().screen) {
      this.screen = true
      return
    }
    throw new Fail({ code: "denied", message: screenDenied() })
  }

  private async capture(args: Args<"look">, deadline: Deadline): Promise<Captured> {
    const area = this.backend.area()
    if (!area) throw new Fail({ code: "unsupported", message: "this machine has no display to look at" })
    this.requireScreen()
    const shot: Shot = await this.backend.shoot(area, deadline.signal)
    const image = await this.codec(shot.bytes, limitOf(args.maxWidth))
    const frame = { id: crypto.randomUUID().slice(0, 12), area, width: image.width, height: image.height }
    this.remember(frame)
    return { frame, image }
  }

  private remember(frame: Frame): void {
    this.current = frame
    this.frames = [frame, ...this.frames.filter((entry) => entry.id !== frame.id)].slice(0, FRAMES)
  }
}

function stepFailure(cause: unknown, deadline: Deadline): string {
  if (deadline.aborted || !(cause instanceof Fail) || cause.code === "denied") throw cause
  return cause.message
}

function regionOf(frame: Frame, zoom: Zoom): Area | null {
  const left = Math.max(0, Math.min(zoom.x, frame.width))
  const top = Math.max(0, Math.min(zoom.y, frame.height))
  const right = Math.min(frame.width, zoom.x + zoom.width)
  const bottom = Math.min(frame.height, zoom.y + zoom.height)
  if (right - left < 1 || bottom - top < 1) return null
  const sx = frame.area.width / frame.width
  const sy = frame.area.height / frame.height
  const originX = Math.floor(frame.area.originX + left * sx)
  const originY = Math.floor(frame.area.originY + top * sy)
  return {
    originX,
    originY,
    width: Math.max(1, Math.ceil(frame.area.originX + right * sx) - originX),
    height: Math.max(1, Math.ceil(frame.area.originY + bottom * sy) - originY),
  }
}

function limitOf(maxWidth: number | undefined): number {
  return Math.min(LONG_EDGE, maxWidth || LONG_EDGE)
}

function wheelPixels(pixels: number): number {
  return Math.sign(pixels) * Math.max(MIN_WHEEL_PIXELS, Math.round(Math.abs(pixels)))
}

function targetOf(step: Step): { x: number; y: number } | null {
  if (step.op === "drag") return { x: step.to[0], y: step.to[1] }
  if (step.op !== "click" && step.op !== "type" && step.op !== "scroll" && step.op !== "move") return null
  if (step.x === undefined || step.y === undefined) return null
  return { x: step.x, y: step.y }
}

function screenDenied(): string {
  if (process.platform === "darwin")
    return "macOS has not allowed kiko-computer-host to record the screen. On the Mac, open System Settings > Privacy & Security > Screen Recording and turn on kiko-computer-host. If an entry is already on, remove it with the minus button and add ~/.kiko-computer/bin/kiko-computer-host again."
  return "this machine has not allowed kiko-computer-host to record the screen."
}

function inputDenied(): string {
  if (process.platform === "darwin")
    return "macOS has not allowed kiko-computer-host to control this Mac. On the Mac, open System Settings > Privacy & Security > Accessibility and turn on kiko-computer-host. If an entry is already on, remove it with the minus button and add ~/.kiko-computer/bin/kiko-computer-host again."
  return "this machine has not allowed kiko-computer-host to control it."
}
