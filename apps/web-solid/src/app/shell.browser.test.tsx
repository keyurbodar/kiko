import "../index.css"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/solid-router"
import { describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../test/render"
import { room } from "../state/room"
import { Shell } from "./shell"
import { defaultWidth, INFO, SIDEBAR } from "./widths"

const ROOM = "01900000-0000-7000-8000-000000000001"

function firstSignIn() {
  const root = createRootRoute({
    component: () => (
      <Shell>
        <Outlet />
      </Shell>
    ),
  })
  const chat = createRoute({
    getParentRoute: () => root,
    path: "/chat/$roomId",
    component: () => {
      room.followRoute(() => ROOM)
      return <p>Chat</p>
    },
  })
  return createRouter({
    routeTree: root.addChildren([chat]),
    history: createMemoryHistory({ initialEntries: [`/chat/${ROOM}`] }),
  })
}

const width = (container: HTMLElement, component: string) =>
  Math.round(container.querySelector(`[data-component="${component}"]`)?.getBoundingClientRect().width ?? -1)

describe("shell", () => {
  it("opens with the right panel closed and the sidebar at its default width on a first sign-in", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    room.followRoute(() => null)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "sidebar-panel")).toBe(defaultWidth(SIDEBAR))
    expect(Math.max(0, width(screen.container, "sidecar-column"))).toBe(0)
  })

  it("opens the right panel at its default width once the owner has opened it", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    localStorage.setItem("kiko:device:panel", "1")
    room.followRoute(() => null)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "sidecar-column")).toBe(defaultWidth(INFO))
    expect(width(screen.container, "sidebar-panel")).toBe(defaultWidth(SIDEBAR))
  })

  it("maximizes the right panel over the chat column and leaves the sidebar width alone", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    localStorage.setItem("kiko:device:panel", "1")
    room.followRoute(() => ROOM)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "sidecar-column")).toBe(defaultWidth(INFO))
    const sidebar = width(screen.container, "sidebar-panel")
    const maximize = () => screen.container.querySelector<HTMLElement>('[data-action="toggle-panel-max"]')
    await expect.element(screen.getByRole("button", { name: "Maximize panel" })).toBeVisible()
    maximize()!.click()

    const overlay = () =>
      screen.container.querySelector<HTMLElement>('[data-component="sidecar-overlay"][data-mode="max"]')
    await expect.poll(() => overlay() !== null).toBe(true)
    expect(width(screen.container, "sidebar-panel")).toBe(sidebar)
    expect(Math.round(overlay()!.getBoundingClientRect().left)).toBe(sidebar)
    expect(Math.round(overlay()!.getBoundingClientRect().width)).toBe(1440 - sidebar)
  })
})
