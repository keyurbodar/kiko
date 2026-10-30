import { dlopen, FFIType, toArrayBuffer, type Pointer } from "bun:ffi"
import { abortReason } from "../deadline"
import { linuxNative } from "../live/native/linux"
import { Fail } from "../log"
import type { Access, Area, Backend, Shot } from "./backend"
import { bmpFromBgra } from "./bmp"
import { IMAGE_FIELDS, xImageFields } from "./ximage"

const ALL_PLANES = 0xffffffff
const ZPIXMAP = 2
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

type Command = { code: number; stderr: string }

function openLibrary() {
  try {
    return dlopen("libX11.so.6", {
      XOpenDisplay: { args: [FFIType.cstring], returns: "ptr" },
      XCloseDisplay: { args: [FFIType.ptr], returns: "i32" },
      XDefaultScreen: { args: [FFIType.ptr], returns: "i32" },
      XDisplayWidth: { args: [FFIType.ptr, FFIType.i32], returns: "i32" },
      XDisplayHeight: { args: [FFIType.ptr, FFIType.i32], returns: "i32" },
      XDefaultRootWindow: { args: [FFIType.ptr], returns: "u64" },
      XGetImage: {
        args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.u32, FFIType.u32, FFIType.u64, FFIType.i32],
        returns: "ptr",
      },
      XFree: { args: [FFIType.ptr], returns: "i32" },
    })
  } catch {
    return null
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function run(command: string[], signal: AbortSignal): Promise<Command> {
  if (signal.aborted) throw abortReason(signal)
  try {
    const child = Bun.spawn({ cmd: command, stdin: "ignore", stdout: "ignore", stderr: "pipe" })
    const stop = () => {
      child.kill()
    }
    signal.addEventListener("abort", stop, { once: true })
    try {
      const stderr = new Response(child.stderr).text()
      const code = await child.exited
      if (signal.aborted) throw abortReason(signal)
      return { code, stderr: (await stderr).trim() }
    } finally {
      signal.removeEventListener("abort", stop)
    }
  } catch (error) {
    if (error instanceof Fail) throw error
    return { code: -1, stderr: reason(error) }
  }
}

function failure(command: string, result: Command): Fail {
  return new Fail({ code: "failed", message: `${command}: ${result.stderr || `exit code ${result.code}`}` })
}

async function openTarget(target: string, signal: AbortSignal): Promise<void> {
  const isPath =
    SCHEME.test(target) ||
    target.startsWith("/") ||
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith("~/")
  if (isPath) {
    const result = await run(["xdg-open", target], signal)
    if (result.code !== 0) throw failure(`xdg-open ${target}`, result)
    return
  }
  const launch = await run(["gtk-launch", target], signal)
  if (launch.code === 0) return
  try {
    Bun.spawn({ cmd: [target], stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref()
  } catch (error) {
    throw new Fail({ code: "failed", message: `${target}: ${reason(error)} (${launch.stderr})` })
  }
}

export function linuxDesk(): Backend | null {
  if (!process.env.DISPLAY) return null
  const native = linuxNative()
  if (!native) return null
  const x11 = openLibrary()
  if (!x11) return null
  const display = x11.symbols.XOpenDisplay(null)
  if (!display) return null
  const screen = x11.symbols.XDefaultScreen(display)
  const root = x11.symbols.XDefaultRootWindow(display)
  let open = true

  const shoot = async (area: Area, signal: AbortSignal): Promise<Shot> => {
    if (signal.aborted) throw abortReason(signal)
    const image = x11.symbols.XGetImage(
      display,
      root,
      area.originX,
      area.originY,
      area.width,
      area.height,
      BigInt(ALL_PLANES),
      ZPIXMAP,
    )
    if (!image) throw new Fail({ code: "failed", message: "XGetImage returned no image" })
    const fields = xImageFields(new DataView(toArrayBuffer(image, 0, IMAGE_FIELDS)))
    try {
      if (fields.bitsPerPixel !== 32) {
        throw new Fail({
          code: "unsupported",
          message: `the X11 display is ${fields.bitsPerPixel} bits per pixel, not 32`,
        })
      }
      const pixels = new Uint8Array(toArrayBuffer(fields.data as Pointer, 0, fields.stride * fields.height))
      return { bytes: bmpFromBgra(pixels, fields.width, fields.height, fields.stride) }
    } finally {
      x11.symbols.XFree(fields.data as Pointer)
      x11.symbols.XFree(image)
    }
  }

  return {
    native,
    area() {
      return {
        originX: 0,
        originY: 0,
        width: x11.symbols.XDisplayWidth(display, screen),
        height: x11.symbols.XDisplayHeight(display, screen),
      }
    },
    shoot,
    access(): Access {
      return { screen: true, input: true }
    },
    requestAccess() {},
    async open(target, signal) {
      await openTarget(target, signal)
    },
    close() {
      if (!open) return
      open = false
      native.release()
      x11.symbols.XCloseDisplay(display)
    },
  }
}
