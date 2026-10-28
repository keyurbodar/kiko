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
  it("opens at the default sidebar and info widths when the chat in view is known only after the shell mounts", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    room.followRoute(() => null)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "sidecar-column")).toBe(defaultWidth(INFO))
    expect(width(screen.container, "sidebar-panel")).toBe(defaultWidth(SIDEBAR))
    expect(localStorage.getItem("kiko:device:card")).not.toBe("0")
  })
})
