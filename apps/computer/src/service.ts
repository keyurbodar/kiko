import { chmod, mkdir, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { CliError } from "./errors"
import { homeDir } from "./platform"

const LABEL = "com.kiko.computer"
const UNIT = "kiko-computer.service"

export type ServiceAction = "install" | "uninstall" | "status"

function selfCommand(): string[] {
  const exec = process.execPath
  if (Bun.main.includes("$bunfs") || /kiko-computer/.test(exec)) return [exec, "run"]
  return [exec, Bun.main, "run"]
}

function quote(argv: string[]): string {
  return argv.map((part) => `"${part.replaceAll('"', '\\"')}"`).join(" ")
}

function shellQuote(argv: string[]): string {
  return argv.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" ")
}

function launchdPath(): string {
  return join(homeDir(), "Library", "LaunchAgents", `${LABEL}.plist`)
}

function systemdPath(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homeDir(), ".config"), "systemd", "user", UNIT)
}

function launchdPlist(): string {
  const program = selfCommand()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${program.map((part) => `    <string>${part}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`
}

function systemdUnit(): string {
  return `[Unit]
Description=kiko computer daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${quote(selfCommand())}
Restart=always
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

export async function service(action: ServiceAction): Promise<number> {
  if (process.platform === "darwin") return launchd(action)
  if (process.platform === "win32") return windows(action)
  return systemd(action)
}

async function launchd(action: ServiceAction): Promise<number> {
  const file = launchdPath()
  if (action === "install") {
    await writeUnit(file, launchdPlist())
    await run(["launchctl", "bootout", `gui/${process.getuid?.() ?? 501}`, file])
    const code = await run(["launchctl", "bootstrap", `gui/${process.getuid?.() ?? 501}`, file])
    if (code !== 0) throw new CliError(`launchctl could not load ${file}`)
    console.log(`installed ${file}`)
    return 0
  }
  if (action === "uninstall") {
    await run(["launchctl", "bootout", `gui/${process.getuid?.() ?? 501}`, file])
    if (await exists(file)) await writeFile(file, "")
    return run(["rm", "-f", file]).then(() => {
      console.log(`removed ${file}`)
      return 0
    })
  }
  const loaded = await run(["launchctl", "print", `gui/${process.getuid?.() ?? 501}/${LABEL}`])
  console.log(
    loaded === 0 ? `${LABEL} is loaded from ${file}` : `${LABEL} is not loaded (run kiko-computer service install)`,
  )
  return 0
}

async function systemd(action: ServiceAction): Promise<number> {
  const file = systemdPath()
  if (action === "install") {
    await writeUnit(file, systemdUnit())
    await run(["systemctl", "--user", "daemon-reload"])
    const code = await run(["systemctl", "--user", "enable", "--now", UNIT])
    if (code !== 0) throw new CliError(`systemctl could not enable ${UNIT}. Run it yourself to see why.`)
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

function scheduledTaskCommand(action: ServiceAction): string[] {
  const program = selfCommand()
  const base = ["schtasks", "/tn", "kiko-computer"]
  if (action === "install") {
    return [...base, "/create", "/f", "/sc", "onlogon", "/tr", `"${shellQuote(program)}"`]
  }
  return [...base, action === "uninstall" ? "/delete" : "/query", "/f"]
}

async function windows(action: ServiceAction): Promise<number> {
  const code = await run(scheduledTaskCommand(action))
  if (code !== 0 && action !== "status") {
    throw new CliError(`schtasks could not ${action} the logon task for kiko-computer`)
  }
  if (action === "install") console.log("installed the kiko-computer logon task")
  return 0
}
