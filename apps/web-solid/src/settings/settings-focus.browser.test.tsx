import "../index.css"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/solid-router"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { Dialog } from "../lib/dialog"
import { SettingsDialog } from "./settings-dialog"

const closed = vi.hoisted(() => ({ count: 0 }))

vi.mock("./open", () => ({
  closeSettings: () => {
    closed.count += 1
  },
}))

function Composer() {
  return <textarea aria-label="Message" />
}

function ToolDialog() {
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Connect app
      </button>
      <Dialog open={open()} onClose={() => setOpen(false)} title="Connect app">
        <input aria-label="App key" />
      </Dialog>
    </>
  )
}

function routerAt(path: string, body: () => ReturnType<typeof ToolDialog>) {
  const root = createRootRoute({
    component: () => (
      <>
        <Composer />
        <Outlet />
      </>
    ),
  })
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    component: () => (
      <SettingsDialog>
        <Outlet />
      </SettingsDialog>
    ),
  })
  const tools = createRoute({ getParentRoute: () => settings, path: "tools", component: body })
  return createRouter({
    routeTree: root.addChildren([settings.addChildren([tools])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

describe("settings focus", () => {
  it("keeps focus inside settings when a deep link opens it over the composer", async () => {
    await page.viewport(1280, 720)
    closed.count = 0
    const router = routerAt("/settings/tools", () => <p>Tools body</p>)
    await using _screen = await render(() => <RouterProvider router={router} />)
    const tools = page.getByRole("dialog").getByRole("button", { name: "Tools", exact: true })
    await expect.element(tools).toHaveFocus()
    document.querySelector("textarea")!.focus()
    await expect.element(tools).toHaveFocus()
    await userEvent.keyboard("zz")
    expect(document.querySelector("textarea")?.value).toBe("")
    await userEvent.keyboard("{Escape}")
    expect(closed.count).toBe(1)
  })

  it("closes settings with Escape after a nested dialog closes", async () => {
    await page.viewport(1280, 720)
    closed.count = 0
    const router = routerAt("/settings/tools", () => <ToolDialog />)
    await using _screen = await render(() => <RouterProvider router={router} />)
    const opener = page.getByRole("button", { name: "Connect app" })
    await opener.click()
    await expect.element(page.getByRole("textbox", { name: "App key" })).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await expect.element(page.getByRole("textbox", { name: "App key" })).not.toBeInTheDocument()
    await expect.element(opener).toHaveFocus()
    expect(closed.count).toBe(0)
    await userEvent.keyboard("{Escape}")
    expect(closed.count).toBe(1)
  })
})
