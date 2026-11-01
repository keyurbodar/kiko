import type { BrowserTab, ComputerSummary } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import Viewer from "./Viewer"

const fakes = vi.hoisted(() => ({
  computer: undefined as ComputerSummary | undefined,
  tabs: [] as BrowserTab[],
}))

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

vi.mock("./BrowserView", () => ({
  default: (props: { pcId: string; tab: string }) => <div data-part="fake-browser" data-tab={props.tab} />,
}))

vi.mock("./terminals", () => ({
  listTerminals: () => Promise.resolve([]),
  openTerminal: () => Promise.resolve(undefined),
}))

vi.mock("./browsers", () => ({ listBrowserTabs: () => Promise.resolve(fakes.tabs) }))

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

const tab = (extra: Partial<BrowserTab> = {}): BrowserTab => ({
  id: "T1",
  browser: "agent-browser",
  title: "Fixture",
  url: "https://example.com/",
  active: true,
  ...extra,
})

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

describe("viewer browser tabs", () => {
  it("lists the agent's browser tabs and paints the chosen one", async () => {
    fakes.tabs = [tab()]
    fakes.computer = mac({ caps: { shell: true, files: true, desktop: true, live: true, input: true, browser: true } })
    await using screen = await render(() => <Viewer />)

    await expect.element(screen.getByText("Fixture")).toBeVisible()
    await screen.getByText("Fixture").click()

    await expect
      .poll(() => screen.container.querySelector('[data-part="fake-browser"]')?.getAttribute("data-tab"))
      .toBe("T1")
  })

  it("offers a takeover on a browser tab even when the desktop is not allowed", async () => {
    fakes.tabs = [tab()]
    fakes.computer = mac({
      caps: { shell: true, files: true, desktop: false, live: false, input: false, browser: true },
    })
    await using screen = await render(() => <Viewer />)

    await screen.getByText("Fixture").click()

    await expect.element(screen.getByText("Take over")).toBeVisible()
  })
})
