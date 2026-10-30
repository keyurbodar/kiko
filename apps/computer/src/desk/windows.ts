import { dlopen, FFIType, type Pointer } from "bun:ffi"
import { abortReason } from "../deadline"
import { windowsNative } from "../live/native/windows"
import { Fail } from "../log"
import type { Area, Backend, Shot } from "./backend"
import { bitmapInfoHeader, bmpFromBgra } from "./bmp"

const SM_CXSCREEN = 0
const SM_CYSCREEN = 1
const SRCCOPY = 0x00cc0020
const CAPTUREBLT = 0x40000000
const DIB_RGB_COLORS = 0

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function openLibraries() {
  try {
    const user32 = dlopen("user32.dll", {
      GetSystemMetrics: { args: [FFIType.i32], returns: "i32" },
      GetDC: { args: [FFIType.ptr], returns: "ptr" },
      ReleaseDC: { args: [FFIType.ptr, FFIType.ptr], returns: "i32" },
    })
    const gdi32 = dlopen("gdi32.dll", {
      CreateCompatibleDC: { args: [FFIType.ptr], returns: "ptr" },
      CreateCompatibleBitmap: { args: [FFIType.ptr, FFIType.i32, FFIType.i32], returns: "ptr" },
      SelectObject: { args: [FFIType.ptr, FFIType.ptr], returns: "ptr" },
      BitBlt: {
        args: [
          FFIType.ptr,
          FFIType.i32,
          FFIType.i32,
          FFIType.i32,
          FFIType.i32,
          FFIType.ptr,
          FFIType.i32,
          FFIType.i32,
          FFIType.u32,
        ],
        returns: "bool",
      },
      GetDIBits: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u32],
        returns: "i32",
      },
      DeleteObject: { args: [FFIType.ptr], returns: "bool" },
      DeleteDC: { args: [FFIType.ptr], returns: "bool" },
    })
    return { user32: user32.symbols, gdi32: gdi32.symbols }
  } catch {
    return null
  }
}

export function windowsDesk(): Backend | null {
  const native = windowsNative()
  if (!native) return null
  const libraries = openLibraries()
  if (!libraries) return null
  const { user32, gdi32 } = libraries

  const shoot = async (area: Area, signal: AbortSignal): Promise<Shot> => {
    if (signal.aborted) throw abortReason(signal)
    const screenDC = user32.GetDC(null)
    if (!screenDC) throw new Fail({ code: "failed", message: "GetDC returned no screen" })
    let memoryDC: Pointer | null = null
    let bitmap: Pointer | null = null
    let previous: Pointer | null = null
    try {
      memoryDC = gdi32.CreateCompatibleDC(screenDC)
      bitmap = gdi32.CreateCompatibleBitmap(screenDC, area.width, area.height)
      if (!memoryDC || !bitmap) {
        throw new Fail({ code: "failed", message: "GDI could not allocate a capture surface" })
      }
      previous = gdi32.SelectObject(memoryDC, bitmap)
      const stride = area.width * 4
      const pixels = new Uint8Array(stride * area.height)
      const info = bitmapInfoHeader(area.width, area.height)
      const copied = gdi32.BitBlt(
        memoryDC,
        0,
        0,
        area.width,
        area.height,
        screenDC,
        area.originX,
        area.originY,
        SRCCOPY | CAPTUREBLT,
      )
      if (previous) {
        gdi32.SelectObject(memoryDC, previous)
        previous = null
      }
      if (!copied) throw new Fail({ code: "failed", message: "BitBlt could not copy the screen" })
      if (gdi32.GetDIBits(memoryDC, bitmap, 0, area.height, pixels, info, DIB_RGB_COLORS) === 0) {
        throw new Fail({ code: "failed", message: "GetDIBits could not read the capture" })
      }
      return { bytes: bmpFromBgra(pixels, area.width, area.height, stride) }
    } finally {
      if (memoryDC && previous) gdi32.SelectObject(memoryDC, previous)
      if (bitmap) gdi32.DeleteObject(bitmap)
      if (memoryDC) gdi32.DeleteDC(memoryDC)
      user32.ReleaseDC(null, screenDC)
    }
  }

  return {
    native,
    area() {
      return {
        originX: 0,
        originY: 0,
        width: user32.GetSystemMetrics(SM_CXSCREEN),
        height: user32.GetSystemMetrics(SM_CYSCREEN),
      }
    },
    shoot,
    access() {
      return { screen: true, input: true }
    },
    requestAccess() {},
    async open(target, signal) {
      if (signal.aborted) throw abortReason(signal)
      try {
        const child = Bun.spawn({
          cmd: ["cmd", "/c", "start", "", target],
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
        })
        const stderr = new Response(child.stderr).text()
        const code = await child.exited
        if (signal.aborted) throw abortReason(signal)
        if (code !== 0) {
          const detail = (await stderr).trim()
          throw new Fail({ code: "failed", message: `start ${target}: ${detail || `exit code ${code}`}` })
        }
      } catch (error) {
        if (error instanceof Fail) throw error
        throw new Fail({ code: "failed", message: `${target}: ${reason(error)}` })
      }
    },
    close() {},
  }
}
