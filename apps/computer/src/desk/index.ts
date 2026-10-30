import type { Backend } from "./backend"
import { linuxDesk } from "./linux"
import { macDesk } from "./macos"
import { windowsDesk } from "./windows"

export function createBackend(): Backend | null {
  if (process.platform === "darwin") return macDesk()
  if (process.platform === "win32") return windowsDesk()
  if (!process.env.DISPLAY) return null
  return linuxDesk()
}
