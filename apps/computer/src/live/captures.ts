import type { Subprocess } from "bun"
import { capturePlans, type Screen } from "./capture"
import { AnnexB, type AccessUnit } from "./annexb"

export type CaptureHandlers = {
  unit(unit: AccessUnit, timestamp: number): void
  failed(reason: string): void
}

export type H264Capture = {
  requestKeyframe(): void
  stop(): void
  running(): boolean
}

export type H264Options = {
  ffmpeg: string
  screen: Screen
  fps: number
  maxWidth: number
  encoders: readonly string[]
  handlers: CaptureHandlers
  onRestart?: () => void
}

const CLOCK = 90_000
const STARTUP_GRACE_MS = 4_000
const RESTART_LIMIT = 5
const RESTART_DELAY_MS = 500
const KEYFRAME_HOLD_MS = 400
const FRESH_MS = 2_000

type Child = Subprocess<"ignore", "pipe", "pipe">

class H264 {
  private readonly options: H264Options
  private readonly plans: string[][]
  private readonly parser = new AnnexB()
  private readonly epoch = performance.now()
  private plan = 0
  private restarts = 0
  private launchedAt = 0
  private child: Child | null = null
  private stopped = false
  private keyframeAt = 0
  private pending: ReturnType<typeof setTimeout> | null = null

  constructor(options: H264Options) {
    this.options = options
    this.plans = capturePlans({
      ffmpeg: options.ffmpeg,
      screen: options.screen,
      format: "h264",
      fps: options.fps,
      maxWidth: options.maxWidth,
      quality: 100,
      encoders: options.encoders,
    })
    this.launch()
  }

  requestKeyframe(): void {
    if (this.stopped) return
    if (performance.now() - this.keyframeAt < KEYFRAME_HOLD_MS) return
    if (performance.now() - this.launchedAt < FRESH_MS) return
    this.restarts = 0
    this.schedule(() => {
      if (this.stopped) return
      this.kill()
      this.launch()
    })
  }

  stop(): void {
    this.stopped = true
    this.clearPending()
    this.kill()
  }

  running(): boolean {
    return !this.stopped && this.child !== null
  }

  private emit(chunk: Uint8Array): void {
    const timestamp = Math.round((performance.now() - this.epoch) * (CLOCK / 1000)) >>> 0
    for (const unit of this.parser.push(chunk)) {
      if (unit.key) this.keyframeAt = performance.now()
      this.options.handlers.unit(unit, timestamp)
    }
  }

  private launch(): void {
    const args = this.plans[this.plan]
    if (this.stopped || !args) return
    this.launchedAt = performance.now()
    this.child = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    void this.pump(this.child)
  }

  private async pump(proc: Child): Promise<void> {
    for await (const chunk of proc.stdout) {
      if (this.stopped || proc !== this.child) return
      this.emit(chunk)
    }
    const tail = await new Response(proc.stderr).text().catch(() => "")
    const code = await proc.exited
    if (this.stopped || proc !== this.child) return
    this.child = null
    this.retry(code, tail)
  }

  private retry(code: number, tail: string): void {
    const healthy = performance.now() - this.launchedAt > STARTUP_GRACE_MS
    if (healthy && this.restarts < RESTART_LIMIT) {
      this.restarts++
      this.options.onRestart?.()
      this.schedule(() => this.launch())
      return
    }
    if (!healthy && this.plan + 1 < this.plans.length) {
      this.plan++
      this.launch()
      return
    }
    this.options.handlers.failed(tail.trim() || `ffmpeg exited with code ${code}`)
    this.stop()
  }

  private schedule(run: () => void): void {
    this.clearPending()
    this.pending = setTimeout(() => {
      this.pending = null
      run()
    }, RESTART_DELAY_MS)
  }

  private clearPending(): void {
    if (this.pending) clearTimeout(this.pending)
    this.pending = null
  }

  private kill(): void {
    this.child?.kill()
    this.child = null
  }
}

export function startH264(options: H264Options): H264Capture {
  return new H264(options)
}

export type MjpegOptions = {
  ffmpeg: string
  screen: Screen
  fps: number
  maxWidth: number
  quality: number
  handlers: { frame(jpeg: Uint8Array): void; failed(reason: string): void }
}

export type MjpegCapture = { stop(): void }

const SOI = 0xffd8
const EOI = 0xffd9

function mark(bytes: Uint8Array, from: number, value: number): number {
  for (let i = from; i + 1 < bytes.byteLength; i++) {
    if (((bytes[i]! << 8) | bytes[i + 1]!) === value) return i
  }
  return -1
}

class Mjpeg {
  private readonly options: MjpegOptions
  private readonly plans: string[][]
  private plan = 0
  private child: Child | null = null
  private stopped = false
  private pending: Uint8Array = new Uint8Array(0)

  constructor(options: MjpegOptions) {
    this.options = options
    this.plans = capturePlans({
      ffmpeg: options.ffmpeg,
      screen: options.screen,
      format: "mjpeg",
      fps: options.fps,
      maxWidth: options.maxWidth,
      quality: options.quality,
      encoders: [],
    })
    this.launch()
  }

  stop(): void {
    this.stopped = true
    this.child?.kill()
    this.child = null
  }

  private launch(): void {
    const args = this.plans[this.plan]
    if (this.stopped || !args) return
    this.pending = new Uint8Array(0)
    this.child = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    void this.pump(this.child)
  }

  private async pump(proc: Child): Promise<void> {
    for await (const chunk of proc.stdout) {
      if (this.stopped || proc !== this.child) return
      this.emit(chunk)
    }
    const tail = await new Response(proc.stderr).text().catch(() => "")
    const code = await proc.exited
    if (this.stopped || proc !== this.child) return
    this.child = null
    if (this.plan + 1 < this.plans.length) {
      this.plan++
      this.launch()
      return
    }
    this.options.handlers.failed(tail.trim() || `ffmpeg exited with code ${code}`)
    this.stopped = true
  }

  private emit(chunk: Uint8Array): void {
    this.pending = join(this.pending, chunk)
    let scan = 0
    while (scan + 3 < this.pending.byteLength) {
      const start = mark(this.pending, scan, SOI)
      if (start < 0) {
        this.pending = this.pending.slice(Math.max(0, this.pending.byteLength - 1))
        return
      }
      const end = mark(this.pending, start + 2, EOI)
      if (end < 0) {
        this.pending = this.pending.slice(start)
        return
      }
      this.options.handlers.frame(this.pending.slice(start, end + 2))
      scan = end + 2
    }
    this.pending = this.pending.slice(scan)
  }
}

export function startMjpeg(options: MjpegOptions): MjpegCapture {
  return new Mjpeg(options)
}

function join(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.byteLength + right.byteLength)
  out.set(left, 0)
  out.set(right, left.byteLength)
  return out
}
