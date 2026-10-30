import type { ComputerSummary } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import LiveScreen from "./LiveScreen"

const fakes = vi.hoisted(() => ({ computer: undefined as ComputerSummary | undefined }))

vi.mock("../computers", () => ({ computerById: () => fakes.computer }))
const started = vi.hoisted(() => ({ count: 0 }))

vi.mock("./session", () => ({
  startSession: () => {
    started.count += 1
    return { close: () => {}, send: () => {} }
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
    await expect.element(screen.getByText(/Allow Screen Recording for kiko-computer-host/)).toBeVisible()
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
})
