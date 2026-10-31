import "../../index.css"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../../test/render"
import Viewer from "./Viewer"

vi.mock("../computers", async () => {
  const { createSignal } = await import("solid-js")
  const [list] = createSignal([
    {
      id: "pc1",
      name: "Desk",
      os: "linux",
      online: true,
      caps: { shell: true, files: true, desktop: true, live: true, input: true },
      holder: "agent",
      displays: [],
    },
  ])
  const [viewing] = createSignal("pc1")
  return {
    computers: list,
    computerById: (id: string) => list().find((c) => c.id === id),
    viewerFor: viewing,
    openViewer: () => {},
    closeViewer: () => {},
    release: async () => ({ ok: true as const }),
    takeOver: async () => ({ ok: true as const }),
  }
})

vi.mock("./LiveScreen", () => ({ default: () => <div data-component="live-screen-stub" /> }))

vi.mock("../../state/user", () => ({ user: { agents: () => [] } }))

describe("computer viewer focus", () => {
  it("keeps Tab focus inside the viewer", async () => {
    await using _screen = await render(() => (
      <>
        <button type="button">Behind</button>
        <Viewer />
      </>
    ))
    await expect.element(page.getByRole("dialog", { name: "Desk screen" })).toBeVisible()
    const panel = document.querySelector<HTMLElement>('[data-component="computer-viewer"] [role="dialog"]')!
    await expect.element(panel).toHaveFocus()
    const takeover = panel.querySelector<HTMLElement>('[data-action="computer-takeover"]')!
    const hide = panel.querySelector<HTMLElement>('[data-action="computer-hide"]')!
    await userEvent.keyboard("{Tab}")
    expect(document.activeElement).toBe(takeover)
    await userEvent.keyboard("{Tab}")
    expect(document.activeElement).toBe(hide)
    await userEvent.keyboard("{Tab}")
    expect(document.activeElement).toBe(takeover)
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}")
    expect(document.activeElement).toBe(hide)
  })
})
