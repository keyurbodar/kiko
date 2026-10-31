import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "@effect/vitest"
import { vi } from "vitest"
import { configDir } from "./config"
import { LABEL, moveToHost, needsHost, selfCommand, sessionEnv, systemdUnit, windowsStopScript } from "./service"

const state = vi.hoisted(() => ({ exec: "", home: "" }))

vi.mock("./self", () => ({ selfArgv: () => [state.exec] }))
vi.mock("./platform", () => ({ homeDir: () => state.home }))

const PROGRAM = ["/home/owner/.kiko-computer/bin/kiko-computer", "run"]
const realPlatform = process.platform
const homes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "kiko-service-"))
  homes.push(home)
  state.home = home
  state.exec = join(home, "bin", "kiko-computer")
  return home
}

function usePlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
}

afterEach(async () => {
  usePlatform(realPlatform)
  delete process.env.XPC_SERVICE_NAME
  vi.unstubAllGlobals()
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe("service command", () => {
  it("carries the config dir the machine was paired into", () => {
    expect(selfCommand("/srv/kiko").slice(-3)).toEqual(["run", "--dir", "/srv/kiko"])
  })

  it("leaves the default config dir off the command", () => {
    expect(selfCommand(configDir())).not.toContain("--dir")
  })
})

describe("systemd unit", () => {
  it("carries the graphical session into the service", () => {
    const unit = systemdUnit(PROGRAM, {
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      XAUTHORITY: "/run/user/1000/xauth",
      XDG_RUNTIME_DIR: "/run/user/1000",
      XDG_SESSION_TYPE: "wayland",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    })
    expect(unit).toContain('Environment="DISPLAY=:0"')
    expect(unit).toContain('Environment="WAYLAND_DISPLAY=wayland-0"')
    expect(unit).toContain('Environment="XAUTHORITY=/run/user/1000/xauth"')
    expect(unit).toContain('Environment="XDG_RUNTIME_DIR=/run/user/1000"')
    expect(unit).toContain('Environment="XDG_SESSION_TYPE=wayland"')
    expect(unit).toContain('Environment="DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus"')
    expect(unit).toContain("After=graphical-session.target")
  })

  it("leaves out variables the installer does not have", () => {
    const unit = systemdUnit(PROGRAM, {})
    expect(unit).not.toContain("Environment=")
    expect(unit).toContain('ExecStart="/home/owner/.kiko-computer/bin/kiko-computer" "run"')
  })

  it("escapes quotes and backslashes for systemd", () => {
    const unit = systemdUnit(PROGRAM, { DISPLAY: 'a"b\\c' })
    expect(unit).toContain('Environment="DISPLAY=a\\"b\\\\c"')
  })
})

describe("macOS host move", () => {
  const launchd = { XPC_SERVICE_NAME: LABEL }
  const direct = "<string>/Users/owner/.kiko-computer/bin/kiko-computer</string>\n<string>run</string>"
  const hosted = "<string>/Users/owner/.kiko-computer/bin/kiko-computer-host</string>\n<string>supervise</string>"

  it("moves a launchd job that still runs the daemon directly", () => {
    expect(needsHost(direct, "darwin", launchd)).toBe(true)
  })

  it("leaves a job that already runs under the host", () => {
    expect(needsHost(hosted, "darwin", launchd)).toBe(false)
  })

  it("leaves a daemon started by hand or on another OS", () => {
    expect(needsHost(direct, "darwin", {})).toBe(false)
    expect(needsHost(direct, "linux", launchd)).toBe(false)
    expect(needsHost(null, "darwin", launchd)).toBe(false)
  })

  it("removes the move job once it has started the hosted service", async () => {
    const home = await tempHome()
    const agents = join(home, "Library", "LaunchAgents")
    await mkdir(agents, { recursive: true })
    await writeFile(join(agents, `${LABEL}.plist`), direct)
    usePlatform("darwin")
    process.env.XPC_SERVICE_NAME = LABEL
    vi.stubGlobal("Bun", { spawn: () => ({ exited: Promise.resolve(0) }), sleep: () => Promise.resolve() })

    await expect(moveToHost()).resolves.toBe(true)
    await expect(stat(join(home, "bin", `${LABEL}.move.plist`))).rejects.toThrow()
  })

  it("removes a stale move job when the service already runs under the host", async () => {
    const home = await tempHome()
    const agents = join(home, "Library", "LaunchAgents")
    await mkdir(agents, { recursive: true })
    await writeFile(join(agents, `${LABEL}.plist`), hosted)
    await mkdir(join(home, "bin"), { recursive: true })
    const move = join(home, "bin", `${LABEL}.move.plist`)
    await writeFile(move, "stale")

    await expect(moveToHost()).resolves.toBe(false)
    await expect(stat(move)).rejects.toThrow()
  })

  it("keeps the move job when launchctl cannot load it", async () => {
    const home = await tempHome()
    const agents = join(home, "Library", "LaunchAgents")
    await mkdir(agents, { recursive: true })
    await writeFile(join(agents, `${LABEL}.plist`), direct)
    usePlatform("darwin")
    process.env.XPC_SERVICE_NAME = LABEL
    vi.stubGlobal("Bun", { spawn: () => ({ exited: Promise.resolve(1) }), sleep: () => Promise.resolve() })

    await expect(moveToHost()).resolves.toBe(false)
    await expect(stat(join(home, "bin", `${LABEL}.move.plist`))).resolves.toBeTruthy()
  })
})

describe("windows daemon", () => {
  it("stops only the daemon this install owns", () => {
    const script = windowsStopScript("C:\\Users\\owner\\kiko-computer.exe", 4242)
    expect(script).toContain("$_.ExecutablePath -eq 'C:\\Users\\owner\\kiko-computer.exe'")
    expect(script).toContain("$_.ProcessId -ne 4242")
    expect(script).not.toContain("/IM")
  })

  it("escapes a quote in the executable path", () => {
    expect(windowsStopScript("C:\\o'wn\\kiko-computer.exe", 1)).toContain("C:\\o''wn\\kiko-computer.exe")
  })
})

describe("systemd session", () => {
  const listing = "HOME=/home/owner\nDISPLAY=:0\nXAUTHORITY=/run/user/1000/.Xauthority\nXDG_RUNTIME_DIR=/run/user/1000"

  it("adopts the graphical session a unit written without it is missing", () => {
    expect(sessionEnv(listing, { XDG_RUNTIME_DIR: "/run/user/1000" })).toEqual({
      DISPLAY: ":0",
      XAUTHORITY: "/run/user/1000/.Xauthority",
    })
  })

  it("keeps a display the unit already carries", () => {
    expect(sessionEnv(listing, { DISPLAY: ":1" })).toEqual({})
    expect(sessionEnv(listing, { WAYLAND_DISPLAY: "wayland-0" })).toEqual({})
  })
})
