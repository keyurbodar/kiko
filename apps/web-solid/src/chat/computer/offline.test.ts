import type { ComputerSummary } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { offlineNotice } from "./offline"

const NOW = 1_800_000_000_000

const mac = (extra: Partial<ComputerSummary> = {}): ComputerSummary => ({
  id: "pc-1",
  name: "Mac",
  os: "macos",
  online: false,
  caps: { shell: true, files: true, desktop: true, live: true, input: true },
  holder: "agent",
  displays: [],
  background: true,
  browsers: [],
  ...extra,
})

describe("offline notice", () => {
  it("says when the computer was last seen and why the connection ended", () => {
    const notice = offlineNotice(mac({ lastSeenAt: NOW - 180_000, lastCloseReason: "the network dropped" }), NOW)

    expect(notice.title).toBe("Mac is offline")
    expect(notice.detail).toBe("last seen 3 minutes ago — the network dropped")
    expect(notice.fix).toBe("Check that this computer is awake and connected to the network.")
  })

  it("asks for an update when the daemon speaks another protocol", () => {
    const notice = offlineNotice(
      mac({ lastSeenAt: NOW - 60_000, lastCloseReason: "its daemon speaks a different protocol version" }),
      NOW,
    )

    expect(notice.detail).toBe("last seen 1 minute ago — its daemon speaks a different protocol version")
    expect(notice.fix).toBe("Update kiko on this computer, then open the app again.")
  })

  it("asks the owner to start kiko when it quit or crashed", () => {
    const notice = offlineNotice(mac({ lastSeenAt: NOW - 3_600_000, lastCloseReason: "it closed normally" }), NOW)

    expect(notice.detail).toBe("last seen 1 hour ago — it closed normally")
    expect(notice.fix).toBe("Start kiko on this computer.")
  })

  it("says a computer has never connected", () => {
    const notice = offlineNotice(mac(), NOW)

    expect(notice.detail).toBe("it has not connected since it was paired")
    expect(notice.fix).toBe("Start kiko on this computer.")
  })
})
