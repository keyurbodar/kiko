import type { Machine } from "../src/types"

const POLL_MS = 250

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function macFrontmost(m: Machine): Promise<string> {
  const front = (await m.exec(["lsappinfo", "front"])).stdout.trim()
  if (!front) return ""
  const info = (await m.exec(["lsappinfo", "info", "-only", "name", front])).stdout
  const match = info.match(/"LSDisplayName"="([^"]+)"/) ?? info.match(/"name"="([^"]+)"/)
  return match?.[1] ?? info.trim()
}

export async function frontmost(m: Machine): Promise<string> {
  if (m.os === "macos") return macFrontmost(m)
  return (await m.exec(["xdotool", "getactivewindow", "getwindowname"])).stdout.trim()
}

export async function waitForFrontmost(m: Machine, expected: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let current = await frontmost(m)
  while (!current.includes(expected) && Date.now() < deadline) {
    await pause(POLL_MS)
    current = await frontmost(m)
  }
  return current
}

async function linuxFocusWindow(m: Machine, title: string): Promise<void> {
  const found = await m.exec(["xdotool", "search", "--name", title])
  const ids = found.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const id = ids.at(-1)
  if (!id) return
  await m.exec(["xdotool", "windowactivate", "--sync", id])
}

export async function focusWindow(m: Machine, title: string): Promise<void> {
  if (m.os === "linux") {
    await linuxFocusWindow(m, title)
    return
  }
  await focusApp(m, title)
}

export async function focusApp(m: Machine, app: string): Promise<void> {
  if (m.os === "macos") {
    await m.exec(["open", "-a", app])
    return
  }
  await focusWindow(m, app)
}
