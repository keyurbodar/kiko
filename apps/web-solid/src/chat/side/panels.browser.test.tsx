import { describe, expect, it } from "vitest"
import { render } from "../../../test/render"
import { launcherEntries, PANELS, panelLabel } from "./panels"
import Sidecar from "./Sidecar"
import { agentSurface, closeAll, fixedSurface, openFile, sidecarSurfaces } from "./surfaces"

const CHAT = "01900000-0000-7000-8000-0000000000aa"

describe("panel table", () => {
  it("drives the launcher, the tab label and the body from one entry per kind", async () => {
    closeAll(CHAT)
    await using screen = await render(() => <Sidecar chatId={CHAT} />)
    const launcher = screen.getByRole("heading", { name: "Open a surface" })
    await expect.element(launcher).toBeVisible()
    for (const entry of launcherEntries(false))
      await expect.element(screen.getByRole("button", { name: new RegExp(`^${entry.label}`) }).first()).toBeVisible()
    expect(launcherEntries(false).map((entry) => entry.kind)).toEqual(["files", "memory", "routines"])
    expect(launcherEntries(true).map((entry) => entry.kind)).toEqual(["files", "memory", "routines", "tasks"])

    await screen
      .getByRole("button", { name: /^Routines/ })
      .first()
      .click()
    const tab = screen.getByRole("tab")
    await expect.element(tab).toHaveTextContent("Routines")
    await expect.element(tab).toHaveAttribute("aria-selected", "true")
    await expect.element(screen.getByRole("tabpanel")).toHaveAttribute("data-kind", "routines")
    expect(sidecarSurfaces(CHAT).map((surface) => surface.id)).toEqual(["routines"])
    closeAll(CHAT)
  })

  it("labels instance panels from their own fields", () => {
    expect(panelLabel(fixedSurface("memory"))).toBe(PANELS.memory.label)
    openFile(CHAT, "notes/plan.md")
    const file = sidecarSurfaces(CHAT).find((surface) => surface.kind === "file")
    expect(file?.id).toBe("file:notes/plan.md")
    expect(file && panelLabel(file)).toBe("plan.md")
    expect(panelLabel(agentSurface("scout"))).toBe("scout")
    closeAll(CHAT)
  })
})
