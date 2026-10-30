import type { ComputerSummary } from "@kiko/protocol"

const PERMISSION = { screen: "Screen Recording", input: "Accessibility" } as const

const INSPECT: Readonly<Record<string, string>> = {
  chrome: "chrome://inspect/#remote-debugging",
  edge: "edge://inspect",
  brave: "brave://inspect",
}

const label = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1)

export function accessHint(computer: ComputerSummary): string | null {
  const access = computer.access
  if (access) {
    const missing = (["screen", "input"] as const).filter((key) => !access[key]).map((key) => PERMISSION[key])
    if (missing.length > 0) {
      const list = missing.join(" and ")
      return computer.os === "macos"
        ? `Allow ${list} for kiko in System Settings > Privacy & Security. If it is already on, remove it and add it again`
        : `Allow ${list} for kiko`
    }
  }
  if ((!computer.caps.desktop || !computer.caps.live) && computer.note) return computer.note
  return null
}

export function backgroundHint(computer: ComputerSummary): string {
  if (computer.background) return "Works in the background"
  if (!computer.online) return "Works in the background once this computer is online"
  if (computer.browsers.length > 0)
    return computer.os === "macos"
      ? "Allow Accessibility for kiko in System Settings > Privacy & Security to work in the background"
      : "Allow kiko to control this computer to work in the background"
  return "Install the kiko app to work in the background: use Add a computer for the install command"
}

export function browserHints(computer: ComputerSummary): string[] {
  return computer.browsers.map((browser) => {
    const name = label(browser.name)
    if (browser.state === "connected") return `${name}: connected`
    if (browser.state === "needs_consent")
      return `${name}: turn on remote debugging once at ${INSPECT[browser.name] ?? INSPECT.chrome}`
    if (browser.state === "not_running") return `${name}: not open`
    return `${name}: kiko cannot drive this browser`
  })
}

export function canControl(computer: ComputerSummary): boolean {
  return computer.online && computer.caps.input && computer.caps.live && computer.access?.input !== false
}
