import type { ComputerSummary } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import LiveScreen from "./LiveScreen"

const fakes = vi.hoisted(() => ({ computer: undefined as ComputerSummary | undefined }))

vi.mock("../computers", () => ({ computerById: () => fakes.computer }))
vi.mock("./session", () => ({ startSession: () => ({ close: () => {}, send: () => {} }) }))

const mac = (access: { screen: boolean; input: boolean }) =>
  ({
    id: "pc-1",
    name: "Mac",
    os: "macos",
    online: true,
    caps: { shell: true, files: true, desktop: true, live: true, input: true },
    holder: "agent",
    displays: [{ id: "primary", width: 1512, height: 982, scale: 1 }],
    access,
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
})
