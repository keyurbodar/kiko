import { hostname } from "node:os"
import { version } from "../package.json"

export const VERSION = process.env.KIKO_COMPUTER_VERSION ?? version

export type OsName = "macos" | "linux"

export function osName(platform = process.platform): OsName {
  return platform === "darwin" ? "macos" : "linux"
}

export function unsupportedOs(platform = process.platform): string | null {
  return platform === "darwin" || platform === "linux" ? null : "kiko computer runs on macOS and Linux only"
}

export function hostName(): string {
  const name = hostname()
  return name.length > 0 ? name : "unknown"
}

export function homeDir(): string {
  return process.env.HOME ?? "."
}
