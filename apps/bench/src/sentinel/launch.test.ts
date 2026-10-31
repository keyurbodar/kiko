import { describe, expect, it } from "vitest"
import { pointerCommand, sentinelCommand, sentinelSource } from "./launch"

const dir = "/repo/apps/bench/src/sentinel"
const log = "/tmp/trial/sentinel.jsonl"
const stop = "/tmp/trial/sentinel.stop"

describe("sentinel commands", () => {
  it("runs the compiled binary on macOS", () => {
    expect(sentinelCommand({ os: "macos", dir, log, stop, binary: "/tmp/Sentinel" })).toEqual([
      "/tmp/Sentinel",
      "--log",
      log,
      "--stop-file",
      stop,
    ])
  })

  it("runs the PowerShell script on Windows", () => {
    expect(sentinelCommand({ os: "windows", dir, log, stop })).toEqual([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      sentinelSource("windows", dir),
      "-Log",
      log,
      "-StopFile",
      stop,
    ])
  })

  it("runs the X11 script on Linux", () => {
    expect(sentinelCommand({ os: "linux", dir, log, stop })).toEqual([
      "python3",
      "-u",
      sentinelSource("linux", dir),
      "--log",
      log,
      "--stop-file",
      stop,
    ])
  })

  it("passes the pointer offset to each platform", () => {
    expect(pointerCommand({ os: "macos", dir, binary: "/tmp/Sentinel", dx: 160, dy: 120 })).toEqual([
      "/tmp/Sentinel",
      "--move-pointer",
      "160,120",
    ])
    expect(pointerCommand({ os: "windows", dir, dx: 160, dy: 120 }).slice(-2)).toEqual(["-MovePointer", "160,120"])
    expect(pointerCommand({ os: "linux", dir, dx: 160, dy: 120 }).slice(-2)).toEqual(["--move-pointer", "160,120"])
  })
})
