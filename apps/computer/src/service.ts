import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { configDir } from "./config"
import { CliError } from "./errors"
import { homeDir } from "./platform"
import { selfArgv } from "./self"

export const LABEL = "com.kiko.computer"
const MOVE_LABEL = `${LABEL}.move`
const UNIT = "kiko-computer.service"
const HOST = "kiko-computer-host"
const WINDOWS_IMAGE = "kiko-computer.exe"
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
const MAC_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
const BOOTOUT_WAIT_MS = 5_000
const BOOTSTRAP_TRIES = 3
const SYSTEMD_ENV = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "DBUS_SESSION_BUS_ADDRESS",
] as const

export type ServiceAction = "install" | "uninstall" | "status"

export function selfCommand(dir: string): string[] {
  const argv = [...selfArgv(), "run"]
  return dir === configDir() ? argv : [...argv, "--dir", dir]
}

function hostPath(): string | null {
  const self = selfArgv()
  const exec = self[0]
  return self.length === 1 && exec ? join(dirname(exec), HOST) : null
}

async function launchdProgram(dir: string): Promise<string[]> {
  const self = selfArgv()
  const exec = self[0]
  if (self.length !== 1 || !exec) return selfCommand(dir)
  const host = join(dirname(exec), HOST)
  if (!(await exists(host))) {
    await copyFile(exec, host)
    await chmod(host, 0o755)
  }
  return [host, "supervise", exec]
}

function quote(argv: string[]): string {
  return argv.map((part) => `"${part.replaceAll('"', '\\"')}"`).join(" ")
}

function xml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function macPath(): string {
  const local = join(homeDir(), ".local", "bin")
  const parts = [...(process.env.PATH ?? "").split(":"), ...MAC_PATHS, local]
  return [...new Set(parts.filter(Boolean))].join(":")
}

function launchdPath(): string {
  return join(homeDir(), "Library", "LaunchAgents", `${LABEL}.plist`)
}

function systemdPath(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homeDir(), ".config"), "systemd", "user", UNIT)
}

function launchdPlist(program: string[], label = LABEL, keepAlive = true): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${program.map((part) => `    <string>${xml(part)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(macPath())}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><${keepAlive}/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`
}

function systemdQuote(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

export function systemdUnit(program: string[], env: NodeJS.ProcessEnv = process.env): string {
  const environment = SYSTEMD_ENV.flatMap((key) => {
    const value = env[key]
    return value === undefined ? [] : [`Environment="${key}=${systemdQuote(value)}"\n`]
  }).join("")
  return `[Unit]
Description=kiko computer daemon
After=network-online.target
After=graphical-session.target
Wants=network-online.target

[Service]
ExecStart=${quote(program)}
${environment}Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
}

async function run(argv: string[]): Promise<number> {
  const proc = Bun.spawn(argv, { stdout: "inherit", stderr: "inherit" })
  return proc.exited
}

async function writeUnit(file: string, body: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, body, { mode: 0o644 })
  await chmod(file, 0o644)
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    (info) => info.isFile(),
    () => false,
  )
}

export function sessionEnv(listing: string, env: NodeJS.ProcessEnv): Record<string, string> {
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return {}
  const wanted = new Set<string>(SYSTEMD_ENV)
  const adopted: Record<string, string> = {}
  for (const line of listing.split("\n")) {
    const at = line.indexOf("=")
    const key = line.slice(0, at)
    if (at > 0 && wanted.has(key) && env[key] === undefined) adopted[key] = line.slice(at + 1)
  }
  return adopted
}

export function adoptSession(): void {
  if (process.platform !== "linux" || !process.env.INVOCATION_ID) return
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return
  try {
    const proc = Bun.spawnSync(["systemctl", "--user", "show-environment"], { stdout: "pipe", stderr: "ignore" })
    if (proc.exitCode === 0) Object.assign(process.env, sessionEnv(proc.stdout.toString("utf8"), process.env))
  } catch {}
}

export function needsHost(plist: string | null, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  return platform === "darwin" && env.XPC_SERVICE_NAME === LABEL && plist !== null && !plist.includes(HOST)
}

export async function moveToHost(): Promise<boolean> {
  const host = hostPath()
  if (!host) return false
  const file = join(dirname(host), `${MOVE_LABEL}.plist`)
  const plist = await readFile(launchdPath(), "utf8").catch(() => null)
  if (!needsHost(plist, process.platform, process.env)) {
    await rm(file, { force: true })
    return false
  }
  const domain = `gui/${process.getuid?.() ?? 501}`
  await writeUnit(file, launchdPlist([...selfArgv(), "service", "install"], MOVE_LABEL, false))
  await quiet(["launchctl", "bootout", `${domain}/${MOVE_LABEL}`])
  const moved = (await quiet(["launchctl", "bootstrap", domain, file])) === 0
  if (moved) await rm(file, { force: true })
  return moved
}

export async function service(action: ServiceAction, dir = configDir()): Promise<number> {
  if (process.platform === "darwin") return launchd(action, dir)
  if (process.platform === "win32") return windows(action, dir)
  return systemd(action, dir)
}

async function quiet(argv: string[]): Promise<number> {
  return Bun.spawn(argv, { stdout: "ignore", stderr: "ignore" }).exited
}

async function bootout(domain: string, file: string): Promise<void> {
  await quiet(["launchctl", "bootout", domain, file])
  const until = Date.now() + BOOTOUT_WAIT_MS
  while (Date.now() < until && (await quiet(["launchctl", "print", `${domain}/${LABEL}`])) === 0) await Bun.sleep(200)
}

async function bootstrap(domain: string, file: string): Promise<boolean> {
  for (let attempt = 0; attempt < BOOTSTRAP_TRIES; attempt++) {
    if ((await quiet(["launchctl", "bootstrap", domain, file])) === 0) return true
    await Bun.sleep(500)
  }
  return (await run(["launchctl", "bootstrap", domain, file])) === 0
}

async function launchd(action: ServiceAction, dir: string): Promise<number> {
  const file = launchdPath()
  const domain = `gui/${process.getuid?.() ?? 501}`
  if (action === "install") {
    await writeUnit(file, launchdPlist(await launchdProgram(dir)))
    await bootout(domain, file)
    if (!(await bootstrap(domain, file))) throw new CliError({ message: `launchctl could not load ${file}` })
    console.log(`installed ${file}`)
    return 0
  }
  if (action === "uninstall") {
    await bootout(domain, file)
    if (await exists(file)) await writeFile(file, "")
    const code = await run(["rm", "-f", file])
    const host = hostPath()
    if (host) await run(["rm", "-f", host, join(dirname(host), `${MOVE_LABEL}.plist`)])
    console.log(`removed ${file}`)
    return code
  }
  const loaded = await quiet(["launchctl", "print", `${domain}/${LABEL}`])
  console.log(
    loaded === 0 ? `${LABEL} is loaded from ${file}` : `${LABEL} is not loaded (run kiko-computer service install)`,
  )
  return 0
}

async function systemd(action: ServiceAction, dir: string): Promise<number> {
  const file = systemdPath()
  if (action === "install") {
    await writeUnit(file, systemdUnit(selfCommand(dir)))
    await run(["systemctl", "--user", "daemon-reload"])
    const enabled = await run(["systemctl", "--user", "enable", UNIT])
    if (enabled !== 0)
      throw new CliError({ message: `systemctl could not enable ${UNIT}. Run it yourself to see why.` })
    const started = await run(["systemctl", "--user", "restart", UNIT])
    if (started !== 0) throw new CliError({ message: `systemctl could not start ${UNIT}. Run it yourself to see why.` })
    console.log(`installed ${file}`)
    return 0
  }
  if (action === "uninstall") {
    await run(["systemctl", "--user", "disable", "--now", UNIT])
    const code = await run(["rm", "-f", file])
    await run(["systemctl", "--user", "daemon-reload"])
    console.log(`removed ${file}`)
    return code
  }
  const active = await run(["systemctl", "--user", "is-active", UNIT])
  console.log(active === 0 ? `${UNIT} is running` : `${UNIT} is not running (run kiko-computer service install)`)
  return 0
}

export function windowsStopScript(exec: string, pid: number): string {
  return `Get-CimInstance Win32_Process -Filter "Name='${WINDOWS_IMAGE}'" | Where-Object { $_.ExecutablePath -eq '${exec.replaceAll("'", "''")}' -and $_.ProcessId -ne ${pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
}

async function stopWindowsDaemon(): Promise<void> {
  if (basename(process.execPath).toLowerCase() !== WINDOWS_IMAGE) return
  await quiet([
    "powershell",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    windowsStopScript(process.execPath, process.pid),
  ])
}

async function windows(action: ServiceAction, dir: string): Promise<number> {
  const program = [...selfCommand(dir), "--background"]
  if (action === "status") {
    const found = await quiet(["reg", "query", RUN_KEY, "/v", "kiko-computer"])
    console.log(
      found === 0
        ? "kiko-computer starts at logon"
        : "kiko-computer is not set to start (run kiko-computer service install)",
    )
    return 0
  }
  await stopWindowsDaemon()
  if (action === "uninstall") {
    await quiet(["reg", "delete", RUN_KEY, "/v", "kiko-computer", "/f"])
    console.log("kiko-computer no longer starts at logon")
    return 0
  }
  const code = await run(["reg", "add", RUN_KEY, "/v", "kiko-computer", "/t", "REG_SZ", "/d", quote(program), "/f"])
  if (code !== 0) throw new CliError({ message: "could not register kiko-computer to start at logon" })
  Bun.spawn(program, { detached: true, stdio: ["ignore", "ignore", "ignore"] }).unref()
  console.log("kiko-computer starts at logon and is running now")
  return 0
}
