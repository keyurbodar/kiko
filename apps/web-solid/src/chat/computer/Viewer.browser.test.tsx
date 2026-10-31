import type { ComputerSummary } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import Viewer from "./Viewer"

const fakes = vi.hoisted(() => ({ computer: undefined as ComputerSummary | undefined }))

vi.mock("../computers", () => ({
  computers: () => [fakes.computer],
  computerById: () => fakes.computer,
  viewerFor: () => fakes.computer?.id ?? null,
  closeViewer: () => {},
  openViewer: () => {},
  release: () => Promise.resolve({ ok: true }),
  takeOver: () => Promise.resolve({ ok: true }),
  takePending: () => false,
}))

vi.mock("./LiveScreen", () => ({ default: () => null }))

vi.mock("./TerminalView", () => ({ default: () => null }))

vi.mock("./terminals", () => ({
  listTerminals: () => Promise.resolve([]),
  openTerminal: () => Promise.resolve(undefined),
}))

const mac = (extra: Partial<ComputerSummary> = {}): ComputerSummary =>
  ({
    id: "pc-1",
    name: "Mac",
    os: "macos",
    online: true,
    caps: { shell: true, files: true, desktop: true, live: true, input: true },
    holder: "agent",
    displays: [],
    background: true,
    browsers: [],
    ...extra,
  }) as ComputerSummary

describe("viewer control state", () => {
  it("shows watching when the agent has the screen", async () => {
    fakes.computer = mac()
    await using screen = await render(() => <Viewer />)
    await expect.element(screen.getByText("Watching Mac")).toBeVisible()
    expect(screen.container.querySelector("[data-state]")?.getAttribute("data-state")).toBe("watching")
  })

  it("shows you have control and offers to hand it back", async () => {
    fakes.computer = mac({ holder: "human", heldBy: "you" })
    await using screen = await render(() => <Viewer />)
    await expect.element(screen.getByText("You have control of Mac")).toBeVisible()
    await expect.element(screen.getByText("I’m done, continue")).toBeVisible()
  })

  it("shows another viewer has control and offers an explicit takeover", async () => {
    fakes.computer = mac({ holder: "human", heldBy: "other" })
    await using screen = await render(() => <Viewer />)
    await expect.element(screen.getByText("Another viewer has control of Mac")).toBeVisible()
    await expect.element(screen.getByText("Take over")).toBeVisible()
  })
})
