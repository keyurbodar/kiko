import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInput } from "../src/live/input"

const READY_MS = 60_000
const RESULT_MS = 30_000
const POLL_MS = 50

function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${what}`))
      setTimeout(tick, POLL_MS)
    }
    tick()
  })
}

const dir = mkdtempSync(join(tmpdir(), "kiko-roundtrip-"))
const ready = join(dir, "ready")
const out = join(dir, "text")
const script = join(import.meta.dir, "windows-roundtrip.ps1")
const child = spawn(
  "powershell.exe",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Ready", ready, "-Out", out],
  { stdio: "inherit" },
)
let input: ReturnType<typeof createInput> = null

try {
  await waitFor(() => existsSync(ready), READY_MS, "the text box")
  input = createInput(null, { holder: () => "human", allowed: () => true })
  if (!input) throw new Error("no Windows input backend on this machine")

  const [left, top, width, height] = readFileSync(ready, "utf8").trim().split(",").map(Number)
  const screen = input.screen() ?? { width: 1, height: 1 }
  const at = { x: (left + width / 2) / screen.width, y: (top + height / 2) / screen.height }

  input.apply([
    { k: "down", x: at.x, y: at.y, b: 0 },
    { k: "up", x: at.x, y: at.y, b: 0 },
    { k: "text", s: "abc" },
    { k: "key", code: "ArrowLeft", key: "ArrowLeft", down: true, mods: 0 },
    { k: "key", code: "ArrowLeft", key: "ArrowLeft", down: false, mods: 0 },
    { k: "text", s: "X" },
    { k: "key", code: "Home", key: "Home", down: true, mods: 0 },
    { k: "key", code: "Home", key: "Home", down: false, mods: 0 },
    { k: "text", s: "Y" },
    { k: "key", code: "Delete", key: "Delete", down: true, mods: 0 },
    { k: "key", code: "Delete", key: "Delete", down: false, mods: 0 },
    { k: "key", code: "End", key: "End", down: true, mods: 0 },
    { k: "key", code: "End", key: "End", down: false, mods: 0 },
    { k: "text", s: "Z" },
    { k: "key", code: "F9", key: "F9", down: true, mods: 0 },
    { k: "key", code: "F9", key: "F9", down: false, mods: 0 },
  ])

  await waitFor(() => existsSync(out), RESULT_MS, "the text box to hand its text back")
  const text = readFileSync(out, "utf8").trimEnd()
  if (text !== "YbXcZ") throw new Error(`the text box holds ${JSON.stringify(text)}, not "YbXcZ"`)
  console.log(`arrow, home, delete and end reached the text box: ${JSON.stringify(text)}`)
} finally {
  input?.release()
  child.kill()
  rmSync(dir, { recursive: true, force: true })
}
