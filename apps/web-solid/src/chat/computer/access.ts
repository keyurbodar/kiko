import type { ComputerSummary } from "@kiko/protocol"

const PERMISSION = { screen: "Screen Recording", input: "Accessibility" } as const

export function accessHint(computer: ComputerSummary): string | null {
  const access = computer.access
  if (access) {
    const missing = (["screen", "input"] as const).filter((key) => !access[key]).map((key) => PERMISSION[key])
    if (missing.length > 0) {
      const list = missing.join(" and ")
      return computer.os === "macos"
        ? `Allow ${list} for kiko-computer-host in System Settings > Privacy & Security. If it is already on, remove it and add it again`
        : `Allow ${list} for kiko-computer-host`
    }
  }
  if (!computer.caps.desktop && computer.note) return computer.note
  return null
}
