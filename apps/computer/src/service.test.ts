import { describe, expect, it } from "@effect/vitest"
import { LABEL, needsHost, sessionEnv, systemdUnit } from "./service"

const PROGRAM = ["/home/owner/.kiko-computer/bin/kiko-computer", "run"]

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
