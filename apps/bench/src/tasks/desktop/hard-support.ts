import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Machine } from "../../types"
import { at, fixture, python, readJson, run, spawnTracked, waitForSpawn, writeJson, writeText } from "../helpers"

export const HARD_LIMITS = { turns: 30, seconds: 300 } as const
export const LONG_LIMITS = { turns: 60, seconds: 1200 } as const

export interface OdsCell {
  readonly text: string
  readonly value?: string
  readonly formula?: string
  readonly type?: string
}

export interface OdsSheet {
  readonly name: string
  readonly rows: readonly (readonly (OdsCell | null)[])[]
}

export interface Ods {
  readonly sheets: readonly OdsSheet[]
  readonly charts: number
}

interface WaylandSession {
  readonly dir: string
  readonly name: string
}

const waylandSession = async (m: Machine): Promise<WaylandSession | undefined> => {
  const probe = await run(m, [
    "sh",
    "-c",
    [
      'for dir in "${XDG_RUNTIME_DIR:-}" "/run/user/$(id -u)"; do',
      '  [ -n "$dir" ] || continue',
      '  for candidate in "$dir"/wayland-*; do',
      '    if [ -S "$candidate" ]; then printf "%s\\n%s\\n" "$dir" "$(basename "$candidate")"; exit 0; fi',
      "  done",
      "done",
    ].join("\n"),
  ])
  const [dir = "", name = ""] = probe.stdout.split("\n")
  return dir && name ? { dir, name } : undefined
}

const typelibEnv = async (m: Machine): Promise<Record<string, string>> => {
  const listed = await run(m, [
    "sh",
    "-c",
    "test -r /etc/kiko-bench/girepository && cat /etc/kiko-bench/girepository || true",
  ])
  const value = listed.stdout.trim()
  return value ? { GI_TYPELIB_PATH: value } : {}
}

const displayEnv = async (m: Machine): Promise<Record<string, string>> => {
  const session = await waylandSession(m)
  return session ? { GDK_BACKEND: "wayland", WAYLAND_DISPLAY: session.name, XDG_RUNTIME_DIR: session.dir } : {}
}

const setLayout = async (m: Machine, layout: string): Promise<void> => {
  if (m.os === "macos") return
  await run(m, [
    "sh",
    "-c",
    [
      `command -v setxkbmap >/dev/null 2>&1 && setxkbmap ${layout} >/dev/null 2>&1 || true`,
      `if [ "\${XDG_CURRENT_DESKTOP:-}" = "GNOME" ] && command -v gsettings >/dev/null 2>&1; then`,
      `  gsettings set org.gnome.desktop.input-sources sources "[('xkb','${layout}')]" >/dev/null 2>&1 || true`,
      "fi",
      `if [ -n "\${HYPRLAND_INSTANCE_SIGNATURE:-}" ] && command -v hyprctl >/dev/null 2>&1; then`,
      `  hyprctl keyword input:kb_layout ${layout} >/dev/null 2>&1 || true`,
      "fi",
    ].join("\n"),
  ])
}

const macosBuild = async (m: Machine, source: string, name: string): Promise<string> => {
  const digest = createHash("sha256").update(readFileSync(source)).digest("hex").slice(0, 12)
  const binary = join(homedir(), ".cache", "kiko-bench", `${name}-${digest}`)
  const exists = await run(m, ["sh", "-c", `test -x '${binary}'`])
  if (exists.code === 0) return binary
  await run(m, ["mkdir", "-p", join(homedir(), ".cache", "kiko-bench")])
  const built = await run(m, ["swiftc", "-O", "-o", binary, source], { timeoutMs: 300_000 })
  if (built.code !== 0) throw new Error(`building the macOS ${name} failed: ${built.stderr || built.stdout}`)
  return binary
}

const macosApp = (m: Machine): Promise<string> => macosBuild(m, fixture("desktop/macos/app.swift"), "desktop-app")

const macosWindowList = (m: Machine): Promise<string> =>
  macosBuild(m, fixture("desktop/macos/windows.swift"), "desktop-windows")

const waitForMacosWindow = async (m: Machine, owners: readonly string[], timeoutMs = 30_000): Promise<void> => {
  const binary = await macosWindowList(m)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const listed = await run(m, [binary])
    const seen = listed.stdout.split("\n").map((line) => line.split("\t")[0] ?? "")
    if (seen.some((owner) => owners.includes(owner))) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`no ${owners.join(" or ")} window appeared within ${timeoutMs} ms`)
}

export const launchHard = async (
  m: Machine,
  screen: string,
  data: unknown,
  request: unknown,
  opts: { env?: Record<string, string>; layout?: string } = {},
): Promise<void> => {
  await writeJson(m, "data.json", data)
  await writeJson(m, "request.json", request)
  if (opts.layout) await setLayout(m, opts.layout)
  const common = [
    "--screen",
    screen,
    "--state",
    at(m, "state.json"),
    "--data",
    at(m, "data.json"),
    "--request",
    at(m, "request.json"),
    "--work",
    m.workdir,
  ]
  const env: Record<string, string> = { ...opts.env }
  let command: string[]
  if (m.os === "macos") {
    command = [await macosApp(m), ...common]
    if (opts.layout) command.push("--layout", opts.layout)
  } else {
    command = [python(m), fixture("desktop/hard1xx/app.py"), ...common]
    Object.assign(env, await displayEnv(m), await typelibEnv(m))
  }
  const app = await spawnTracked(m, command, Object.keys(env).length > 0 ? { env } : {})
  await writeText(m, "app.pid", `${app.pid}\n`)
  await waitForSpawn(m, "state.json")
}

export const runHardOracle = async (m: Machine, screen: string): Promise<void> => {
  const result = await run(m, [python(m), fixture("desktop/hard1xx/oracle/control.py"), screen, m.workdir], {
    timeoutMs: 120_000,
  })
  if (result.code !== 0) throw new Error(`desktop oracle failed: ${result.stderr || result.stdout}`)
}

export const hardState = async (m: Machine): Promise<Record<string, any> | undefined> =>
  readJson<Record<string, any>>(m, "state.json")

const libreoffice = async (m: Machine): Promise<string> => {
  const macos = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
  const found = await run(m, [
    "sh",
    "-c",
    `command -v soffice || command -v libreoffice || { test -x '${macos}' && printf '%s\\n' '${macos}'; }`,
  ])
  const binary = found.stdout.trim().split("\n")[0] ?? ""
  if (!binary) throw new Error("LibreOffice is not installed")
  return binary
}

const startLibreOffice = async (m: Machine, args: readonly string[]): Promise<void> => {
  const binary = await libreoffice(m)
  const profile = `file://${at(m, "lo-profile")}`
  await run(
    m,
    [binary, "--headless", "--norestore", "--nologo", `-env:UserInstallation=${profile}`, "--terminate_after_init"],
    { timeoutMs: 180_000 },
  )
  const app = await spawnTracked(m, [binary, "--norestore", "--nologo", `-env:UserInstallation=${profile}`, ...args])
  await writeText(m, "app.pid", `${app.pid}\n`)
  if (m.os === "macos") await waitForMacosWindow(m, ["soffice", "LibreOffice"])
}

export const launchCalc = (m: Machine, rel: string): Promise<void> => startLibreOffice(m, ["--calc", at(m, rel)])

export const launchCalcBlank = (m: Machine): Promise<void> => startLibreOffice(m, ["--calc"])

export const buildOds = async (m: Machine, spec: unknown, rel: string): Promise<void> => {
  await writeJson(m, "ods-spec.json", spec)
  const result = await run(m, [
    python(m),
    fixture("desktop/hard1xx/ods.py"),
    "build",
    at(m, "ods-spec.json"),
    at(m, rel),
  ])
  if (result.code !== 0) throw new Error(`building ${rel} failed: ${result.stderr || result.stdout}`)
}

export const readOds = async (m: Machine, rel: string): Promise<Ods> => {
  const result = await run(m, [python(m), fixture("desktop/hard1xx/ods.py"), "read", at(m, rel)])
  if (result.code !== 0) throw new Error(`reading ${rel} failed: ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout) as Ods
}

export const odsNumber = (cell: OdsCell | null | undefined): number | undefined => {
  if (!cell) return undefined
  if (cell.value !== undefined && cell.value !== "") {
    const parsed = Number(cell.value)
    if (Number.isFinite(parsed)) return parsed
  }
  const parsed = Number(cell.text)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const round2 = (value: number): number => Math.round(value * 100) / 100

export const closeTo = (actual: number | undefined, expected: number): boolean =>
  actual !== undefined && Math.abs(actual - expected) < 0.005
