import { join } from "node:path"
import type { Os } from "../types"

export interface LaunchOptions {
  readonly os: Os
  readonly dir: string
  readonly log: string
  readonly stop: string
  readonly binary?: string
}

export interface PointerOptions {
  readonly os: Os
  readonly dir: string
  readonly binary?: string
  readonly dx: number
  readonly dy: number
}

export function sentinelSource(os: Os, dir: string): string {
  switch (os) {
    case "macos":
      return join(dir, "native", "macos", "Sentinel.swift")
    case "linux":
      return join(dir, "native", "linux", "sentinel.py")
    default: {
      const exhaustive: never = os
      throw new Error(`the sentinel has no build for ${exhaustive}`)
    }
  }
}

export function sentinelCommand(options: LaunchOptions): readonly string[] {
  switch (options.os) {
    case "macos":
      return [options.binary ?? sentinelSource("macos", options.dir), "--log", options.log, "--stop-file", options.stop]
    case "linux":
      return ["python3", "-u", sentinelSource("linux", options.dir), "--log", options.log, "--stop-file", options.stop]
    default: {
      const exhaustive: never = options.os
      throw new Error(`the sentinel has no build for ${exhaustive}`)
    }
  }
}

export function pointerCommand(options: PointerOptions): readonly string[] {
  const offset = `${options.dx},${options.dy}`
  switch (options.os) {
    case "macos":
      return [options.binary ?? sentinelSource("macos", options.dir), "--move-pointer", offset]
    case "linux":
      return ["python3", "-u", sentinelSource("linux", options.dir), "--move-pointer", offset]
    default: {
      const exhaustive: never = options.os
      throw new Error(`the sentinel cannot move a pointer on ${exhaustive}`)
    }
  }
}
