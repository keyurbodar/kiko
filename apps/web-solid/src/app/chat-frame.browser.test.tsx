import "../index.css"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "@tanstack/solid-router"
import { describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { ChatFrame } from "./chat-frame"
import { roomForRoute } from "./sections"
import { room } from "../state/room"

const ROOM = "01900000-0000-7000-8000-0000000000e1"
const OTHER = "01900000-0000-7000-8000-0000000000e2"

function routerAt(path: string) {
  const root = createRootRoute({
    component: () => {
      const location = useLocation()
      room.followRoute((previous) => roomForRoute(previous, location().pathname, location().search))
      return <Outlet />
    },
  })
  const chat = createRoute({ getParentRoute: () => root, id: "/_chat", component: ChatFrame })
  const roomPage = createRoute({
    getParentRoute: () => chat,
    path: "/chat/$roomId",
    component: () => <p data-testid="room-page">room</p>,
  })
  const customize = createRoute({
    getParentRoute: () => chat,
    path: "/customize",
    component: () => <p data-testid="customize-page">Customize</p>,
  })
  return createRouter({
    routeTree: root.addChildren([chat.addChildren([roomPage, customize])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

describe("chat frame", () => {
  it("keeps the chat and its draft mounted while Customize is open", async () => {
    await page.viewport(1200, 800)
    localStorage.clear()
    const router = routerAt(`/chat/${ROOM}`)
    await using screen = await render(() => <RouterProvider router={router} />)

    const shell = () => screen.container.querySelector<HTMLElement>('[data-component="chat-shell"]')
    await expect.poll(shell).not.toBeNull()
    const first = shell()!
    first.dataset.mountProbe = "kept"
    await expect.poll(() => screen.container.querySelector('[contenteditable="true"]')).not.toBeNull()
    const editor = screen.container.querySelector<HTMLElement>('[contenteditable="true"]')!
    await userEvent.click(editor)
    await userEvent.keyboard("half a thought")

    router.history.push("/customize")
    await expect.element(screen.getByTestId("customize-page")).toBeVisible()
    expect(shell()).toBe(first)
    expect(shell()?.dataset.mountProbe).toBe("kept")
    expect(screen.container.querySelector('[data-component="chat-view"]')?.hasAttribute("inert")).toBe(true)

    router.history.back()
    await expect.element(screen.getByTestId("room-page")).toBeVisible()
    expect(shell()).toBe(first)
    expect(shell()?.dataset.mountProbe).toBe("kept")
    expect(screen.container.querySelector('[data-component="chat-view"]')?.hasAttribute("inert")).toBe(false)
  })

  it("follows a chat, then keeps it while Customize covers it, and forgets it on a page that is not chat", async () => {
    localStorage.clear()
    const router = routerAt(`/chat/${ROOM}`)
    await using _screen = await render(() => <RouterProvider router={router} />)
    await expect.poll(() => room.activeId()).toBe(ROOM)

    router.history.push("/customize")
    await expect.poll(() => room.activeId()).toBe(ROOM)

    router.history.push(`/chat/${OTHER}`)
    await expect.poll(() => room.activeId()).toBe(OTHER)
  })
})
