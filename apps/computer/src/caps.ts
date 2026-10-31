import type { Caps, Display } from "@kiko/computer/wire"
import type { DriverState } from "./driver"
import type { Logger } from "./log"
import type { LiveCaps } from "./live"
import { findBinary } from "./live/binary"

export type Access = { screen: boolean; input: boolean }

export type Detection = {
  caps: Caps
  displays: Display[]
  access: Access | null
  reason: string | null
}

const NO_DRIVER = "the kiko app is not running on this machine, so desktop tools are off"
const STARTING = "the kiko app is still connecting its desktop engine"
const FFMPEG_NOTE =
  process.platform === "darwin"
    ? "the live view needs ffmpeg on this computer: brew install ffmpeg"
    : "the live view needs ffmpeg on this computer"

function hasFfmpeg(configDir?: string): boolean {
  return findBinary("ffmpeg", configDir) !== null
}

function permitted(grant: string | undefined): boolean {
  return grant === "granted" || grant === "not_needed"
}

export function accessOf(state: DriverState | null): Access | null {
  if (!state) return null
  return { screen: permitted(state.permissions.screen), input: permitted(state.permissions.accessibility) }
}

function displaysOf(state: DriverState | null): Display[] {
  return [...(state?.displays ?? [])]
}

function capsFor(state: DriverState | null, ffmpeg: boolean, live: LiveCaps): Caps {
  const desktop = state?.desktop !== undefined
  return {
    shell: true,
    files: true,
    desktop,
    live: live.live && desktop && ffmpeg,
    input: live.input && desktop,
  }
}

function reasonFor(state: DriverState | null, ffmpeg: boolean): string | null {
  if (!state) return NO_DRIVER
  if (!state.desktop) return STARTING
  return ffmpeg ? null : FFMPEG_NOTE
}

export function detect(
  log: Logger,
  live: LiveCaps = { live: false, input: false },
  state: DriverState | null = null,
  configDir?: string,
): Detection {
  const ffmpeg = hasFfmpeg(configDir)
  const reason = reasonFor(state, ffmpeg)
  if (reason && !state) log.warn(`${reason}; desktop tools are off`)
  return {
    caps: capsFor(state, ffmpeg, live),
    displays: displaysOf(state),
    access: accessOf(state),
    reason,
  }
}

export function presence(): Detection {
  return {
    caps: { shell: true, files: true, desktop: false, live: false, input: false },
    displays: [],
    access: null,
    reason: NO_DRIVER,
  }
}
