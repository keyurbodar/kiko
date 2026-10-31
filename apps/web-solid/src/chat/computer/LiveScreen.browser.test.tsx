import type { ComputerSummary } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../../test/render"
import { fakeTimers } from "../../../test/timers"
import LiveScreen from "./LiveScreen"

const NOW = Date.UTC(2026, 9, 25, 12)

const fakes = vi.hoisted(() => ({
  computer: undefined as ComputerSummary | undefined,
  taking: undefined as (() => boolean) | undefined,
  sent: [] as { k?: string; code?: string; down?: boolean; s?: string }[][],
}))

vi.mock("../computers", () => ({
  computerById: () => fakes.computer,
  takePending: () => fakes.taking?.() ?? false,
}))
const started = vi.hoisted(() => ({ count: 0 }))

vi.mock("./session", () => ({
  startSession: () => {
    started.count += 1
    return {
      close: () => {},
      send: (events: { k?: string; code?: string; down?: boolean; s?: string }[]) => fakes.sent.push(events),
    }
  },
}))

const mac = (access: { screen: boolean; input: boolean }, extra: Partial<ComputerSummary> = {}) =>
  ({
    id: "pc-1",
    name: "Mac",
    os: "macos",
    online: true,
    caps: { shell: true, files: true, desktop: true, live: true, input: true },
    holder: "agent",
    displays: [{ id: "primary", width: 1512, height: 982, scale: 1 }],
    access,
    ...extra,
  }) as unknown as ComputerSummary

describe("live screen", () => {
  it("says which permission is missing instead of waiting to connect", async () => {
    fakes.computer = mac({ screen: false, input: true })
    await using screen = await render(() => <LiveScreen pcId="pc-1" interactive={false} />)
    await expect.element(screen.getByText(/Allow Screen Recording for kiko/)).toBeVisible()
  })

  it("connects when every permission is allowed", async () => {
    fakes.computer = mac({ screen: true, input: true })
    await using screen = await render(() => <LiveScreen pcId="pc-1" interactive={false} />)
    await expect.element(screen.getByText("Connecting to the screen")).toBeVisible()
  })

  it("names what is missing and never starts a stream when the live view is off", async () => {
    started.count = 0
    fakes.computer = mac(
      { screen: true, input: true },
      {
        caps: { shell: true, files: true, desktop: true, live: false, input: true },
        note: "the live view needs ffmpeg on this computer: brew install ffmpeg",
      },
    )
    await using screen = await render(() => <LiveScreen pcId="pc-1" interactive={false} />)
    await expect.element(screen.getByText(/brew install ffmpeg/)).toBeVisible()
    expect(started.count).toBe(0)
  })

  it("holds keys typed in the takeover gap and sends them in order once control lands", async () => {
    fakes.computer = mac({ screen: true, input: true })
    fakes.sent = []
    const [taking, setTaking] = createSignal(false)
    fakes.taking = taking
    await using screen = await render(() => <LiveScreen pcId="pc-1" interactive />)
    const sink = screen.container.querySelector<HTMLTextAreaElement>('[data-part="sink"]')
    expect(sink).not.toBeNull()
    sink?.focus()
    setTaking(true)

    await userEvent.keyboard("abc")
    expect(fakes.sent).toEqual([])

    setTaking(false)
    await expect.poll(() => fakes.sent.length).toBe(1)
    expect(
      fakes.sent
        .flat()
        .filter((event) => event.k === "key")
        .map((event) => `${event.code}:${event.down ? "down" : "up"}`),
    ).toEqual(["KeyA:down", "KeyA:up", "KeyB:down", "KeyB:up", "KeyC:down", "KeyC:up"])
  })

  it("says why the computer is offline and what to do about it", async () => {
    using _timers = fakeTimers()
    vi.setSystemTime(NOW)
    fakes.computer = mac(
      { screen: true, input: true },
      { online: false, lastSeenAt: NOW - 180_000, lastCloseReason: "the network dropped" },
    )
    await using screen = await render(() => <LiveScreen pcId="pc-1" interactive={false} />)
    await expect.element(screen.getByText("Mac is offline")).toBeVisible()
    await expect.element(screen.getByText(/last seen 3 minutes ago — the network dropped/)).toBeVisible()
    await expect
      .element(screen.getByText("Check that this computer is awake and connected to the network."))
      .toBeVisible()
  })
})
