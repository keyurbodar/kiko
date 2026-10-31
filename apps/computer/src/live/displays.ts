import type { Display } from "@kiko/computer/wire"
import { platform, type Platform } from "./capture"

const OS_MS = 5_000

export type Window = { x: number; y: number; width: number; height: number; z: number }

export type Command = { code: number; out: string }

export type DisplayDeps = {
  platform?: Platform
  run?: (cmd: string[]) => Promise<Command>
}

const MONITOR = /^\s*(\d+):\s+[+*]*(\S+)\s+(\d+)\/\d+x(\d+)\/\d+\+(-?\d+)\+(-?\d+)/gm
const OUTPUT = /^(\S+) connected(?: primary)? (\d+)x(\d+)\+(-?\d+)\+(-?\d+)/gm

const MAC_SCREENS = `ObjC.import('AppKit')
const screens = $.NSScreen.screens
let mainHeight = 0
for (let index = 0; index < screens.count; index++) {
  const frame = screens.objectAtIndex(index).frame
  if (Math.abs(frame.origin.x) < 0.5 && Math.abs(frame.origin.y) < 0.5) mainHeight = frame.size.height
}
const out = []
for (let index = 0; index < screens.count; index++) {
  const screen = screens.objectAtIndex(index)
  const frame = screen.frame
  out.push({
    id: String(ObjC.unwrap(screen.deviceDescription.objectForKey('NSScreenNumber'))),
    index,
    width: Math.round(frame.size.width),
    height: Math.round(frame.size.height),
    scale: screen.backingScaleFactor,
    x: Math.round(frame.origin.x),
    y: Math.round(mainHeight - (frame.origin.y + frame.size.height)),
  })
}
JSON.stringify(out)`

function display(id: string, width: number, height: number, x: number, y: number, scale = 1): Display {
  return { id, width, height, scale, originX: x, originY: y }
}

export function parseMonitors(text: string): Display[] {
  const found: Display[] = []
  for (const match of text.matchAll(MONITOR)) {
    const [, , name, width, height, x, y] = match
    if (!name || !width || !height) continue
    found.push(display(name, Number(width), Number(height), Number(x), Number(y)))
  }
  return found
}

export function parseOutputs(text: string): Display[] {
  const found: Display[] = []
  for (const match of text.matchAll(OUTPUT)) {
    const [, name, width, height, x, y] = match
    if (!name || !width || !height) continue
    found.push(display(name, Number(width), Number(height), Number(x), Number(y)))
  }
  return found
}

export function parseScreens(json: string): Display[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const found: Display[] = []
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue
    const { id, width, height, scale, x, y } = item as Record<string, unknown>
    if (typeof id !== "string" || typeof width !== "number" || typeof height !== "number") continue
    if (width < 1 || height < 1) continue
    found.push(display(id, Math.round(width), Math.round(height), Number(x ?? 0), Number(y ?? 0), Number(scale ?? 1)))
  }
  return found
}

export function parseWindows(value: unknown): Window[] {
  if (typeof value !== "object" || value === null) return []
  const list = (value as { windows?: unknown }).windows
  if (!Array.isArray(list)) return []
  const found: Window[] = []
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue
    const window = item as { bounds?: unknown; z_index?: unknown; layer?: unknown; is_on_screen?: unknown }
    if (window.is_on_screen === false) continue
    if (typeof window.z_index !== "number") continue
    if (typeof window.layer === "number" && window.layer !== 0) continue
    const bounds = window.bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | undefined
    if (!bounds || typeof bounds.width !== "number" || typeof bounds.height !== "number") continue
    found.push({
      x: Number(bounds.x ?? 0),
      y: Number(bounds.y ?? 0),
      width: bounds.width,
      height: bounds.height,
      z: Number(window.z_index),
    })
  }
  return found
}

function inside(display: Display, x: number, y: number): boolean {
  const left = display.originX ?? 0
  const top = display.originY ?? 0
  return x >= left && x < left + display.width && y >= top && y < top + display.height
}

export function focusedDisplay(displays: readonly Display[], windows: readonly Window[]): number {
  let best: Window | null = null
  for (const window of windows) {
    if (window.width < 1 || window.height < 1) continue
    if (!best || window.z > best.z) best = window
  }
  if (best) {
    const x = best.x + best.width / 2
    const y = best.y + best.height / 2
    const index = displays.findIndex((entry) => inside(entry, x, y))
    if (index >= 0) return index
  }
  const primary = displays.findIndex((entry) => (entry.originX ?? 0) === 0 && (entry.originY ?? 0) === 0)
  return primary >= 0 ? primary : 0
}

export function orderDisplays(displays: readonly Display[], windows: readonly Window[]): Display[] {
  if (displays.length < 2) return [...displays]
  const index = focusedDisplay(displays, windows)
  return [displays[index]!, ...displays.filter((_, at) => at !== index)]
}

function system(command: readonly string[]): Promise<Command> {
  return new Promise((resolve) => {
    try {
      const child = Bun.spawn([...command], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
        signal: AbortSignal.timeout(OS_MS),
      })
      void new Response(child.stdout)
        .text()
        .then((out) => child.exited.then((code) => resolve({ code, out })))
        .catch(() => resolve({ code: -1, out: "" }))
    } catch {
      resolve({ code: -1, out: "" })
    }
  })
}

export async function listDisplays(deps: DisplayDeps = {}): Promise<Display[]> {
  const name = deps.platform ?? platform()
  const run = deps.run ?? system
  if (name === "linux") {
    const monitors = await run(["xrandr", "--listmonitors"])
    const found = monitors.code === 0 ? parseMonitors(monitors.out) : []
    if (found.length > 0) return found
    const outputs = await run(["xrandr", "--query"])
    return outputs.code === 0 ? parseOutputs(outputs.out) : []
  }
  if (name === "macos") {
    const screens = await run(["osascript", "-l", "JavaScript", "-e", MAC_SCREENS])
    return screens.code === 0 ? parseScreens(screens.out.trim()) : []
  }
  return []
}
