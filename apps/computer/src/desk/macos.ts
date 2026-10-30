import { readFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dlopen, FFIType } from "bun:ffi"
import { macNative } from "../live/native/macos"
import { Fail } from "../log"
import { selfArgv } from "../self"
import type { Access, Area, Backend, Shot } from "./backend"

const CORE_GRAPHICS = "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
const SCREENSHOT = "/usr/sbin/screencapture"
const ACCESS_TIMEOUT_MS = 5_000
const URL_TARGET = /^[a-z][a-z0-9+.-]*:/i

type Display = { id: () => number; wide: (display: number) => number; high: (display: number) => number }

type Permissions = {
  preflightScreen: () => boolean
  preflightInput: () => boolean
  requestScreen: () => boolean
  requestInput: () => boolean
}

export function launchCommand(target: string): string[] {
  const app = !URL_TARGET.test(target) && !target.startsWith("/") && !target.startsWith("~")
  return app ? ["open", "-a", target] : ["open", target]
}

export function parseAccess(text: string): Access | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== "object" || value === null) return null
    const record = value as Record<string, unknown>
    if (typeof record.screen !== "boolean" || typeof record.input !== "boolean") return null
    return { screen: record.screen, input: record.input }
  } catch {
    return null
  }
}

function openDisplay(): Display | null {
  try {
    const symbols = dlopen(CORE_GRAPHICS, {
      CGMainDisplayID: { args: [], returns: FFIType.u32 },
      CGDisplayPixelsWide: { args: [FFIType.u32], returns: FFIType.u64 },
      CGDisplayPixelsHigh: { args: [FFIType.u32], returns: FFIType.u64 },
    }).symbols
    return {
      id: () => symbols.CGMainDisplayID(),
      wide: (display) => Number(symbols.CGDisplayPixelsWide(display)),
      high: (display) => Number(symbols.CGDisplayPixelsHigh(display)),
    }
  } catch {
    return null
  }
}

function openPermissions(): Permissions | null {
  try {
    const symbols = dlopen(CORE_GRAPHICS, {
      CGPreflightScreenCaptureAccess: { args: [], returns: FFIType.bool },
      CGPreflightPostEventAccess: { args: [], returns: FFIType.bool },
      CGRequestScreenCaptureAccess: { args: [], returns: FFIType.bool },
      CGRequestPostEventAccess: { args: [], returns: FFIType.bool },
    }).symbols
    return {
      preflightScreen: () => symbols.CGPreflightScreenCaptureAccess(),
      preflightInput: () => symbols.CGPreflightPostEventAccess(),
      requestScreen: () => symbols.CGRequestScreenCaptureAccess(),
      requestInput: () => symbols.CGRequestPostEventAccess(),
    }
  } catch {
    return null
  }
}

export function preflightAccess(): Access {
  const permissions = openPermissions()
  if (!permissions) return { screen: false, input: false }
  return { screen: permissions.preflightScreen(), input: permissions.preflightInput() }
}

function freshAccess(): Access | null {
  try {
    const proc = Bun.spawnSync({
      cmd: [...selfArgv(), "access"],
      stdout: "pipe",
      stderr: "ignore",
      timeout: ACCESS_TIMEOUT_MS,
    })
    if (proc.exitCode !== 0) return null
    return parseAccess(proc.stdout.toString("utf8"))
  } catch {
    return null
  }
}

function aborted(): Fail {
  return new Fail({ code: "cancelled", message: "the call was cancelled" })
}

async function capture(signal: AbortSignal): Promise<Shot> {
  if (signal.aborted) throw aborted()
  const file = join(tmpdir(), `kiko-computer-${crypto.randomUUID()}.png`)
  const proc = Bun.spawn([SCREENSHOT, "-x", "-m", "-t", "png", file], { stdout: "ignore", stderr: "ignore" })
  const kill = () => proc.kill()
  signal.addEventListener("abort", kill, { once: true })
  try {
    const code = await proc.exited
    if (signal.aborted) throw aborted()
    if (code !== 0) throw new Fail({ code: "failed", message: `screencapture exited with ${code}` })
    const bytes = new Uint8Array(await readFile(file))
    if (bytes.length === 0) throw new Fail({ code: "failed", message: "screencapture wrote no image" })
    return { bytes }
  } finally {
    signal.removeEventListener("abort", kill)
    await unlink(file).catch(() => undefined)
  }
}

async function launch(target: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw aborted()
  const proc = Bun.spawn(launchCommand(target), { stdout: "ignore", stderr: "pipe" })
  const kill = () => proc.kill()
  signal.addEventListener("abort", kill, { once: true })
  try {
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) throw new Fail({ code: "failed", message: `open failed: ${stderr.trim() || `exit ${code}`}` })
  } finally {
    signal.removeEventListener("abort", kill)
  }
}

export function macDesk(): Backend | null {
  if (process.platform !== "darwin") return null
  const display = openDisplay()
  const permissions = openPermissions()
  const native = macNative()
  if (!display || !permissions || !native) return null
  return {
    native,
    area(): Area | null {
      const width = display.wide(display.id())
      const height = display.high(display.id())
      if (width <= 0 || height <= 0) return null
      return { width, height, originX: 0, originY: 0 }
    },
    shoot(_area, signal) {
      return capture(signal)
    },
    access() {
      return freshAccess() ?? { screen: permissions.preflightScreen(), input: permissions.preflightInput() }
    },
    requestAccess() {
      if (!permissions.preflightInput()) permissions.requestInput()
      if (!permissions.preflightScreen()) permissions.requestScreen()
    },
    open(target, signal) {
      return launch(target, signal)
    },
    close() {
      native.release()
    },
  }
}
