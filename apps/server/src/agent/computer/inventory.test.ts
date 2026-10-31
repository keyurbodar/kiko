import { describe, expect, it } from "vitest"
import { computerListText, computersContext } from "./inventory"
import type { ComputerSummary } from "./types"

const mac = (extra: Partial<ComputerSummary> = {}): ComputerSummary => ({
  id: "pc-mac",
  name: "mac",
  os: "macos",
  online: true,
  caps: { shell: true, files: true, desktop: true, live: true, input: true, terminal: true, background: true },
  holder: "agent",
  displays: [],
  background: true,
  browsers: [{ name: "chrome", state: "connected" }],
  ...extra,
})

const box = (extra: Partial<ComputerSummary> = {}): ComputerSummary => ({
  id: "pc-box",
  name: "build-box",
  os: "linux",
  online: false,
  caps: { shell: true, files: true, desktop: false, live: false, input: false },
  holder: "agent",
  displays: [],
  background: false,
  browsers: [],
  ...extra,
})

describe("computersContext", () => {
  it("is empty when nothing is paired", () => {
    expect(computersContext([])).toBeUndefined()
  })

  it("names each computer with its os, state and capabilities", () => {
    expect(computersContext([mac(), box()])).toBe(
      "computers: mac (macos, online, shell, files, terminal, desktop, browser), build-box (linux, offline, shell, files).",
    )
  })

  it("stays byte for byte the same while nothing changes", () => {
    const all = [mac(), box()]
    expect(computersContext(all)).toBe(computersContext([mac(), box()]))
  })

  it("stops at eight computers and points at the list tool", () => {
    const many = Array.from({ length: 10 }, (_, index) => mac({ id: `pc-${index}`, name: `pc-${index}` }))
    const line = computersContext(many) ?? ""
    expect(line).toContain("pc-7")
    expect(line).not.toContain("pc-8")
    expect(line).toContain("and 2 more, shown by computer_list")
  })
})

describe("computerListText", () => {
  it("says when an offline computer was last seen and why it dropped", () => {
    const now = 100_000_000
    const text = computerListText(
      [
        mac({ version: "3.1.0" }),
        box({ version: "3.0.0", lastSeenAt: now - 240_000, lastCloseReason: "the network dropped" }),
      ],
      now,
    )
    expect(text).toContain("mac (id pc-mac): macos, online, shell, files, terminal, desktop, browser.")
    expect(text).toContain("daemon 3.1.0.")
    expect(text).toContain("build-box (id pc-box): linux, offline, shell, files.")
    expect(text).toContain("last seen 4 minutes ago.")
    expect(text).toContain("the last connection ended because the network dropped.")
  })

  it("says how to pair one when there are none", () => {
    expect(computerListText([])).toContain("no computers are paired")
  })
})
