import { hostname } from "node:os"
import { version } from "../package.json"

export const VERSION = version

export type OsName = "macos" | "linux" | "windows"

export function osName(platform = process.platform): OsName {
  if (platform === "darwin") return "macos"
  if (platform === "win32") return "windows"
  return "linux"
}

export function hostName(): string {
  const name = hostname()
  return name.length > 0 ? name : "unknown"
}

export function shellCommand(command: string): string[] {
  return process.platform === "win32" ? ["powershell", "-NoProfile", "-Command", command] : ["/bin/sh", "-lc", command]
}

export function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "."
}
