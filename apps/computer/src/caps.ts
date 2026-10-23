import type { Caps, Display } from "@kiko/computer/wire"
import { connectDriver, findDriver, type DriverHandle } from "./driver"
import { Desktop } from "./desktop"
import type { Logger } from "./log"
import type { LiveCaps } from "./live"

export type Detection = {
  driverPath: string | null
  driver: DriverHandle | null
  desktop: Desktop | null
  caps: Caps
  displays: Display[]
}

function hasDesktopSession(): boolean {
  if (process.platform === "linux") return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
  return true
}

function hasFfmpeg(): boolean {
  return Bun.which("ffmpeg") !== null
}

function capsFor(driver: boolean, ffmpeg: boolean, live: LiveCaps): Caps {
  return {
    shell: true,
    files: true,
    desktop: driver,
    live: live.live && driver && ffmpeg,
    input: live.input && driver,
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

async function readDisplays(driver: DriverHandle): Promise<Display[]> {
  if (!driver.tools.has("get_screen_size")) return []
  const result = await driver.call("get_screen_size", {}, 8000)
  if (result.isError) return []
  const width = asNumber(result.structured.width)
  const height = asNumber(result.structured.height)
  const scale = asNumber(result.structured.scale_factor) ?? 1
  if (width === null || height === null || width <= 0 || height <= 0) return []
  return [{ id: "primary", width: Math.round(width), height: Math.round(height), scale }]
}

export async function detect(
  dir: string,
  log: Logger,
  live: LiveCaps = { live: false, input: false },
): Promise<Detection> {
  const driverPath = findDriver(dir)
  const session = hasDesktopSession()
  const ffmpeg = hasFfmpeg()
  if (!driverPath) log.warn("cua-driver was not found on PATH or in the config dir; desktop tools are off")
  if (!session) log.warn("no DISPLAY or WAYLAND_DISPLAY; desktop tools are off")
  if (!driverPath || !session) {
    return { driverPath, driver: null, desktop: null, caps: capsFor(false, ffmpeg, live), displays: [] }
  }
  try {
    const driver = await connectDriver(driverPath)
    const displays = await readDisplays(driver)
    return {
      driverPath,
      driver,
      desktop: new Desktop(driver, log),
      caps: capsFor(true, ffmpeg, live),
      displays,
    }
  } catch (error) {
    log.warn(`cua-driver did not answer: ${error instanceof Error ? error.message : String(error)}`)
    return { driverPath, driver: null, desktop: null, caps: capsFor(false, ffmpeg, live), displays: [] }
  }
}
