import type { Caps, Display } from "@kiko/computer/wire"
import type { Access, Backend } from "./desk/backend"
import { createBackend } from "./desk"
import { Desktop } from "./desktop"
import type { Logger } from "./log"
import type { LiveCaps } from "./live"
import { findBinary } from "./live/binary"

export type Detection = {
  backend: Backend | null
  desktop: Desktop | null
  caps: Caps
  displays: Display[]
  access: Access | null
  reason: string | null
}

const FFMPEG_NOTE =
  process.platform === "darwin"
    ? "the live view needs ffmpeg on this computer: brew install ffmpeg"
    : "the live view needs ffmpeg on this computer"

function hasFfmpeg(configDir?: string): boolean {
  return findBinary("ffmpeg", configDir) !== null
}

function capsFor(desktop: boolean, ffmpeg: boolean, live: LiveCaps): Caps {
  return {
    shell: true,
    files: true,
    desktop,
    live: live.live && desktop && ffmpeg,
    input: live.input && desktop,
  }
}

function noBackendReason(): string {
  if (process.platform !== "linux") return "the desktop backend for this system did not load"
  if (process.env.DISPLAY) return "the desktop backend for this X11 session did not load"
  if (process.env.WAYLAND_DISPLAY) return "this is a Wayland-only session; desktop tools need X11"
  return "no DISPLAY is set; desktop tools need an X11 session"
}

function displaysOf(backend: Backend | null): Display[] {
  const area = backend?.area() ?? null
  if (!area) return []
  return [{ id: "primary", width: area.width, height: area.height, scale: 1 }]
}

function detectionOf(backend: Backend | null, ffmpeg: boolean, live: LiveCaps): Detection {
  return {
    backend,
    desktop: backend ? new Desktop(backend) : null,
    caps: capsFor(backend !== null, ffmpeg, live),
    displays: displaysOf(backend),
    access: backend?.access() ?? null,
    reason: backend ? (ffmpeg ? null : FFMPEG_NOTE) : noBackendReason(),
  }
}

export function presence(): Detection {
  return detectionOf(createBackend(), hasFfmpeg(), { live: false, input: false })
}

export function detect(log: Logger, live: LiveCaps = { live: false, input: false }, configDir?: string): Detection {
  const backend = createBackend()
  if (!backend) log.warn(`${noBackendReason()}; desktop tools are off`)
  return detectionOf(backend, hasFfmpeg(configDir), live)
}
