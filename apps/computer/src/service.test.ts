import { describe, expect, it } from "@effect/vitest"
import { systemdUnit } from "./service"

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
