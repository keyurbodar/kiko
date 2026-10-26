import type { Args, Control, Step, Value } from "@kiko/computer/wire"
import type { DriverHandle, DriverResult } from "./driver"
import { Fail, type Logger } from "./log"
import { InputQueue } from "./queue"
import { abortReason, type Deadline } from "./deadline"

const LONG_EDGE = 1280
const MAX_CONTROLS = 200
const MAX_TREE_CHARS = 12_000
const JPEG_QUALITY = 80

type Space = "desktop" | "window"

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }

type Element = { token: string; role: string; label: string; x: number; y: number; w: number; h: number }

type Frame = {
  id: string
  space: Space
  pid: number | null
  windowId: number | null
  width: number
  height: number
  toDriver: number
  app?: string
  title?: string
  elements: Map<number, Element>
  tree?: string
  image?: { mime: "image/jpeg"; data: string }
}

type Encoded = {
  value: { mime: "image/jpeg"; data: string }
  width: number
  height: number
  toDriver: number
}

type DesktopShot = { frame: Frame; pointScale: number }

const DRIVER_WINDOW = /^Cua\.|cua-driver/i

type WindowInfo = { pid: number; windowId: number; app: string; title: string; z: number }

type Origin = { x: number; y: number; pixelsPerPoint: number }

export class Desktop {
  readonly queue = new InputQueue()
  private frames: Frame[] = []
  private current: Frame | null = null
  private heldDrag: { frame: Frame; from: { x: number; y: number } } | null = null
  pointer: ((x: number, y: number) => void) | null = null

  constructor(
    private readonly driver: DriverHandle,
    private readonly log: Logger,
  ) {}

  async look(args: Args<"look">, deadline: Deadline): Promise<Value<"look">> {
    const frame = await this.capture(args, deadline)
    this.remember(frame)
    const view: Mutable<Value<"look">> = {
      captureId: frame.id,
      width: frame.width,
      height: frame.height,
      controls: args.controls === false ? [] : controlsOf(frame),
    }
    if (frame.app) view.app = frame.app
    if (frame.title) view.title = frame.title
    if (frame.tree) view.tree = frame.tree
    if (args.image !== false && frame.image) view.image = frame.image
    return view
  }

  async act(args: Args<"act">, deadline: Deadline): Promise<Value<"act">> {
    const frame = this.resolve(args.captureId)
    let done = 0
    for (const step of args.steps) {
      if (deadline.signal.aborted) throw new Fail({ code: "cancelled", message: "the call was cancelled" })
      await this.queue.run(
        () => this.step(frame, step, deadline),
        () => this.releaseHeldInputs(),
      )
      done += 1
    }
    const view = await this.look({ image: args.image }, deadline.child(10_000))
    return { done, view }
  }

  async releaseHeldInputs(): Promise<void> {
    const held = this.heldDrag
    this.heldDrag = null
    if (!held) return
    const point = held.from
    const args = {
      ...this.targetArgs(held.frame, {}),
      from_x: point.x,
      from_y: point.y,
      to_x: point.x,
      to_y: point.y,
      duration_ms: 0,
    }
    await this.driver.call("drag", args, 5000).catch(() => undefined)
  }

  private async step(frame: Frame, step: Step, deadline: Deadline): Promise<void> {
    if (deadline.signal.aborted) throw new Fail({ code: "cancelled", message: "the call was cancelled" })
    this.showPointer(frame, step)
    if (step.op === "wait") return Bun.sleep(Math.min(step.ms, Math.max(0, deadline.remaining() - 500)))
    if (step.op === "key") return this.keys(this.targetArgs(frame, {}), step.keys, deadline)
    if (step.op === "open") return this.launch(step.app, deadline)
    if (step.op === "type") return this.type(frame, step, deadline)
    if (step.op === "click") return this.click(frame, step, deadline)
    if (step.op === "drag") return this.drag(frame, step, deadline)
    if (step.op === "scroll") return this.scroll(frame, step, deadline)
    return this.move(frame, step.x, step.y, deadline)
  }

  private async click(frame: Frame, step: Extract<Step, { op: "click" }>, deadline: Deadline): Promise<void> {
    const element = this.elementOf(frame, step.id)
    const target = element ? this.elementScope(frame, element) : this.pointArgs(frame, step.x, step.y)
    await this.call("click", { ...target, button: step.button ?? "left", count: step.count ?? 1 }, deadline)
  }

  private async type(frame: Frame, step: Extract<Step, { op: "type" }>, deadline: Deadline): Promise<void> {
    const element = this.elementOf(frame, step.id)
    const scope = element ? this.elementScope(frame, element) : this.pointArgs(frame, step.x, step.y)
    await this.call("type_text", { ...scope, text: step.text }, deadline)
    if (step.submit) await this.keys(this.targetArgs(frame, {}), "return", deadline)
  }

  private async keys(scope: Record<string, unknown>, keys: string, deadline: Deadline): Promise<void> {
    const parts = keys
      .split("+")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
    const key = parts.at(-1)
    if (!key) throw new Fail({ code: "failed", message: "a key step needs a key name" })
    const modifiers = parts.slice(0, -1)
    const target = scope.pid === undefined || scope.window_id === undefined ? { scope: "desktop" } : scope
    if (modifiers.length > 0 && this.has("hotkey")) {
      await this.call("hotkey", { ...target, keys: [...modifiers, key] }, deadline)
      return
    }
    await this.call("press_key", { ...target, key, modifiers }, deadline)
  }

  private async scroll(frame: Frame, step: Extract<Step, { op: "scroll" }>, deadline: Deadline): Promise<void> {
    const vertical = step.dy !== 0
    const direction = vertical ? (step.dy < 0 ? "up" : "down") : step.dx < 0 ? "left" : "right"
    const travel = Math.abs(vertical ? step.dy : step.dx)
    const amount = Math.max(1, Math.min(20, Math.round(travel / 100) || 1))
    const point = step.x === undefined || step.y === undefined ? {} : this.pointArgs(frame, step.x, step.y)
    await this.call("scroll", { ...this.targetArgs(frame, {}), ...point, direction, amount }, deadline)
  }

  private async drag(frame: Frame, step: Extract<Step, { op: "drag" }>, deadline: Deadline): Promise<void> {
    const from = this.point(frame, step.from[0], step.from[1])
    const to = this.point(frame, step.to[0], step.to[1])
    this.heldDrag = { frame, from }
    try {
      await this.call(
        "drag",
        { ...this.targetArgs(frame, {}), from_x: from.x, from_y: from.y, to_x: to.x, to_y: to.y },
        deadline,
      )
    } finally {
      this.heldDrag = null
    }
  }

  private async move(frame: Frame, x: number, y: number, deadline: Deadline): Promise<void> {
    const point = this.point(frame, x, y)
    await this.call("move_cursor", { ...this.targetArgs(frame, {}), ...point }, deadline)
  }

  private async launch(app: string, deadline: Deadline): Promise<void> {
    if (!this.has("launch_app"))
      throw new Fail({ code: "unsupported", message: "this machine cannot launch applications" })
    await this.call("launch_app", { name: app }, deadline)
  }

  private elementOf(frame: Frame, id: number | undefined): Element | null {
    if (id === undefined) return null
    const element = frame.elements.get(id)
    if (!element) throw new Fail({ code: "stale", message: `control ${id} is gone; look again for fresh ids` })
    return element
  }

  private showPointer(frame: Frame, step: Step): void {
    if (!this.pointer || frame.space !== "desktop" || frame.width <= 0 || frame.height <= 0) return
    const at = targetOf(frame, step)
    if (at) this.pointer(at.x / frame.width, at.y / frame.height)
  }

  private elementScope(frame: Frame, element: Element): Record<string, unknown> {
    return { element_token: element.token, pid: frame.pid, window_id: frame.windowId }
  }

  private pointArgs(frame: Frame, x: number | undefined, y: number | undefined): Record<string, unknown> {
    if (x === undefined || y === undefined) throw new Fail({ code: "failed", message: "a pixel step needs x and y" })
    return this.targetArgs(frame, this.point(frame, x, y))
  }

  private point(frame: Frame, x: number, y: number): { x: number; y: number } {
    if (frame.toDriver === 1) return { x, y }
    return { x: Math.round(x * frame.toDriver), y: Math.round(y * frame.toDriver) }
  }

  private targetArgs(frame: Frame, extra: Record<string, unknown>): Record<string, unknown> {
    if (frame.space === "window") return { ...extra, pid: frame.pid, window_id: frame.windowId }
    return { ...extra, scope: "desktop" }
  }

  private resolve(captureId: string | undefined): Frame {
    if (!captureId) {
      if (!this.current) throw new Fail({ code: "stale", message: "there is no view yet; look first" })
      return this.current
    }
    const found = this.frames.find((frame) => frame.id === captureId)
    if (!found) throw new Fail({ code: "stale", message: "that capture id is gone; look again" })
    return found
  }

  private remember(frame: Frame): void {
    this.current = frame
    this.frames = [frame, ...this.frames.filter((entry) => entry.id !== frame.id)].slice(0, 4)
  }

  private async capture(args: Args<"look">, deadline: Deadline): Promise<Frame> {
    const limit = clampEdge(args.maxWidth)
    const image = args.image !== false
    const window = await this.frontWindow(deadline)
    const desktop = await this.desktopFrame(limit, deadline)
    if (desktop) return this.mergeDesktop(desktop, window, limit, deadline, args.controls !== false)
    if (!window) throw new Fail({ code: "unsupported", message: "this machine returned no screenshot" })
    const state = await this.windowState(window, limit, deadline, image)
    if (!state) throw new Fail({ code: "unsupported", message: "this machine returned no screenshot" })
    return state.frame
  }

  private async desktopFrame(limit: number, deadline: Deadline): Promise<DesktopShot | null> {
    if (!this.has("get_desktop_state")) return null
    try {
      const result = await this.call("get_desktop_state", { max_image_dimension: limit }, deadline)
      const captureId = text(result.structured.capture_id)
      const shotWidth = positive(result.structured.screenshot_width)
      const shotHeight = positive(result.structured.screenshot_height)
      const screenWidth = positive(result.structured.screen_width) ?? shotWidth
      if (!captureId || !shotWidth || !shotHeight || !screenWidth) {
        throw new Fail({ code: "failed", message: "cua-driver returned no desktop capture" })
      }
      const encoded = await this.encode(result.image, limit)
      const width = encoded?.width ?? shotWidth
      const height = encoded?.height ?? shotHeight
      return {
        frame: {
          id: captureId,
          space: "desktop",
          pid: null,
          windowId: null,
          width,
          height,
          toDriver: shotWidth / width,
          elements: new Map(),
          image: encoded?.value,
        },
        pointScale: width / screenWidth,
      }
    } catch (error) {
      this.log.warn(`get_desktop_state failed: ${describe(error)}`)
      return null
    }
  }

  private async mergeDesktop(
    desktop: DesktopShot,
    window: WindowInfo | null,
    limit: number,
    deadline: Deadline,
    wantsControls: boolean,
  ): Promise<Frame> {
    const frame = desktop.frame
    if (!window || !wantsControls) return frame
    const state = await this.windowState(window, limit, deadline, false)
    if (!state) return { ...frame, app: window.app, title: window.title }
    const merged: Frame = {
      ...frame,
      pid: state.frame.pid,
      windowId: state.frame.windowId,
      app: state.frame.app,
      title: state.frame.title,
      tree: state.frame.tree,
    }
    const { x: originX, y: originY, pixelsPerPoint } = state.origin
    const ratio = desktop.pointScale / pixelsPerPoint
    merged.elements = new Map(
      [...state.frame.elements].map(([id, element]) => [
        id,
        {
          ...element,
          x: Math.round((originX + element.x / pixelsPerPoint) * desktop.pointScale),
          y: Math.round((originY + element.y / pixelsPerPoint) * desktop.pointScale),
          w: Math.round(element.w * ratio),
          h: Math.round(element.h * ratio),
        },
      ]),
    )
    return merged
  }

  private async frontWindow(deadline: Deadline): Promise<WindowInfo | null> {
    if (!this.has("list_windows")) return null
    try {
      const result = await this.call("list_windows", { on_screen_only: true }, deadline)
      return pickFront(list(result.structured.windows))
    } catch {
      return null
    }
  }

  private async windowState(
    window: WindowInfo,
    limit: number,
    deadline: Deadline,
    wantImage: boolean,
  ): Promise<{ frame: Frame; origin: Origin } | null> {
    if (!this.has("get_window_state")) return null
    const args: Record<string, unknown> = {
      pid: window.pid,
      window_id: window.windowId,
      include_screenshot: wantImage,
      include_accessibility_tree: true,
      max_elements: MAX_CONTROLS,
      max_image_dimension: limit,
      timeout_ms: Math.max(100, Math.min(120_000, deadline.remaining())),
    }
    if (this.hasTreeFormat()) args.tree_format = "elements"
    try {
      const result = await this.call("get_window_state", args, deadline)
      return await this.parseWindow(window, result, limit)
    } catch (error) {
      this.log.warn(`get_window_state failed: ${describe(error)}`)
      return null
    }
  }

  private async parseWindow(
    window: WindowInfo,
    result: DriverResult,
    limit: number,
  ): Promise<{ frame: Frame; origin: Origin }> {
    const structured = result.structured
    const shotWidth = positive(structured.screenshot_width)
    const shotHeight = positive(structured.screenshot_height)
    const encoded = await this.encode(result.image, limit)
    const width = encoded?.width ?? shotWidth ?? 0
    const height = encoded?.height ?? shotHeight ?? 0
    const frame: Frame = {
      id: text(structured.capture_id) ?? text(structured.snapshot_id) ?? `${window.pid}-${window.windowId}`,
      space: "window",
      pid: window.pid,
      windowId: window.windowId,
      width,
      height,
      toDriver: shotWidth && width ? shotWidth / width : 1,
      app: text(structured.app_name) ?? window.app,
      title: text(structured.window_title) ?? window.title,
      elements: new Map(),
      image: encoded?.value,
    }
    const elements = list(structured.elements)
    if (elements.length > 0) fillElements(frame, elements, text(structured.snapshot_id))
    else fillFromMarkdown(frame, structured, text(structured.snapshot_id))
    const tree = text(structured.tree_markdown)
    if (tree) frame.tree = tree.slice(0, MAX_TREE_CHARS)
    return { frame, origin: originOf(structured, frame, shotWidth) }
  }

  private async encode(image: { mime: string; base64: string } | null, limit: number): Promise<Encoded | null> {
    if (!image) return null
    const bytes = Buffer.from(image.base64, "base64")
    const meta = await new Bun.Image(bytes).metadata()
    const longEdge = Math.max(meta.width, meta.height)
    const scale = longEdge > limit ? limit / longEdge : 1
    const width = Math.max(1, Math.round(meta.width * scale))
    const height = Math.max(1, Math.round(meta.height * scale))
    const pipeline = new Bun.Image(bytes)
    if (scale < 1) pipeline.resize(width, height)
    const out = await pipeline.jpeg({ quality: JPEG_QUALITY }).bytes()
    return {
      value: { mime: "image/jpeg", data: Buffer.from(out).toString("base64") },
      width,
      height,
      toDriver: meta.width / width,
    }
  }

  private has(name: string): boolean {
    return this.driver.tools.has(name)
  }

  private hasTreeFormat(): boolean {
    return "tree_format" in record(record(this.driver.tools.get("get_window_state")?.schema).properties)
  }

  private async call(name: string, args: Record<string, unknown>, deadline: Deadline): Promise<DriverResult> {
    if (!this.has(name)) throw new Fail({ code: "unsupported", message: `cua-driver has no ${name} tool` })
    const schema = this.driver.tools.get(name)?.schema
    let result: DriverResult
    try {
      result = await this.driver.call(name, filterArgs(schema, args), deadline.remaining(), deadline.signal)
    } catch (error) {
      if (deadline.aborted) throw abortReason(deadline.signal)
      const message = describe(error)
      throw new Fail({
        code: /timed? ?out/i.test(message) ? "timeout" : "failed",
        message: `cua-driver ${name} failed: ${message}`,
      })
    }
    if (!result.isError) return result
    throw refusal(name, result)
  }
}

function controlsOf(frame: Frame): Control[] {
  return [...frame.elements].map(([id, element]) => ({
    id,
    role: element.role,
    label: element.label,
    x: element.x,
    y: element.y,
    w: element.w,
    h: element.h,
  }))
}

function refusal(name: string, result: DriverResult): Fail {
  const structured = record(result.structured)
  const payload = record(structured.refusal)
  const code = text(payload.code) ?? text(structured.code) ?? ""
  const message = text(payload.message) ?? result.text ?? `${name} was refused`
  if (/stale/i.test(code) || /stale/i.test(message)) return new Fail({ code: "stale", message: message })
  if (/timed? ?out/i.test(code)) return new Fail({ code: "timeout", message: message })
  return new Fail({ code: "failed", message: message })
}

function pickFront(windows: unknown[]): WindowInfo | null {
  let best: WindowInfo | null = null
  for (const entry of windows) {
    const window = record(entry)
    const pid = positive(window.pid)
    const windowId = positive(window.window_id)
    if (!pid || !windowId) continue
    const candidate = {
      pid: Math.round(pid),
      windowId: Math.round(windowId),
      app: text(window.app_name) ?? "",
      title: text(window.title) ?? "",
      z: num(window.z_index),
    }
    if (DRIVER_WINDOW.test(candidate.title) || DRIVER_WINDOW.test(candidate.app)) continue
    if (!best || candidate.z > best.z) best = candidate
  }
  return best
}

function elementBox(entry: Record<string, unknown>, toDriver: number): { x: number; y: number; w: number; h: number } {
  const screenshot = record(entry.screenshot_frame)
  const source = Object.keys(screenshot).length > 0 ? screenshot : record(entry.frame)
  const divide = toDriver === 0 ? 1 : toDriver
  return {
    x: Math.max(0, Math.round(num(source.x) / divide)),
    y: Math.max(0, Math.round(num(source.y) / divide)),
    w: Math.max(0, Math.round(num(source.w) / divide)),
    h: Math.max(0, Math.round(num(source.h) / divide)),
  }
}

function fillElements(frame: Frame, elements: unknown[], snapshotId: string | undefined): void {
  for (const raw of elements) {
    const entry = record(raw)
    const index = num(entry.element_index, -1)
    const token = text(entry.element_token) ?? (snapshotId ? `${snapshotId}:${index}` : undefined)
    if (index < 0 || !token) continue
    frame.elements.set(index, {
      token,
      role: text(entry.role) ?? "element",
      label: text(entry.label) ?? text(entry.value) ?? "",
      ...elementBox(entry, frame.toDriver),
    })
  }
}

function fillFromMarkdown(frame: Frame, structured: Record<string, unknown>, snapshotId: string | undefined): void {
  const markdown = text(structured.tree_markdown)
  if (!markdown || !snapshotId) return
  for (const line of markdown.split("\n")) {
    const match = /^\s*[-*]?\s*\[(\d+)]\s+(\S+)\s*(.*)$/.exec(line)
    const index = match ? Number(match[1]) : Number.NaN
    if (!match || !Number.isInteger(index)) continue
    frame.elements.set(index, {
      token: `${snapshotId}:${index}`,
      role: match[2] ?? "element",
      label: (match[3] ?? "").replace(/^"|"$/g, "").trim(),
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    })
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function positive(value: unknown): number | null {
  const parsed = num(value)
  return parsed > 0 ? parsed : null
}

function originOf(structured: Record<string, unknown>, frame: Frame, shotWidth: number | null): Origin {
  const bounds = record(structured.window_bounds)
  const width = positive(bounds.width)
  const deliveredPerPoint = width && shotWidth ? shotWidth / width : (positive(structured.screenshot_scale) ?? 1)
  return {
    x: num(bounds.x),
    y: num(bounds.y),
    pixelsPerPoint: deliveredPerPoint / (frame.toDriver || 1) || 1,
  }
}

function targetOf(frame: Frame, step: Step): { x: number; y: number } | null {
  if (step.op === "drag") return { x: step.to[0], y: step.to[1] }
  if (step.op !== "click" && step.op !== "type" && step.op !== "scroll" && step.op !== "move") return null
  const element = "id" in step && step.id !== undefined ? frame.elements.get(step.id) : undefined
  if (element) return { x: element.x + element.w / 2, y: element.y + element.h / 2 }
  if (step.x === undefined || step.y === undefined) return null
  return { x: step.x, y: step.y }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampEdge(value: number | undefined): number {
  if (!value || value <= 0) return LONG_EDGE
  return Math.max(320, Math.min(LONG_EDGE, Math.round(value)))
}

function filterArgs(
  schema: Record<string, unknown> | undefined,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const properties = record(record(schema).properties)
  if (Object.keys(properties).length === 0) return args
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || !(key in properties)) continue
    out[key] = value
  }
  return out
}
