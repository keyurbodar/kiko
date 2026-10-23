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
import { render } from "../../test/render"
import { useApp } from "../lib/store"
import { roomInUrl } from "./sections"

const FIRST = "01900000-0000-7000-8000-000000000001"
const SECOND = "01900000-0000-7000-8000-000000000002"

function routerAt(path: string) {
  const root = createRootRoute({
    component: () => {
      const location = useLocation()
      useApp.followRoute(() => roomInUrl(location().pathname, location().search))
      return (
        <>
          <output data-testid="room">{useApp.activeThreadId() ?? "none"}</output>
          <Outlet />
        </>
      )
    },
  })
  const chat = createRoute({ getParentRoute: () => root, path: "/chat/$roomId" })
  const recipes = createRoute({ getParentRoute: () => root, path: "/recipes" })
  return createRouter({
    routeTree: root.addChildren([chat, recipes]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

describe("active room", () => {
  it("is the room in the URL, and follows every navigation at once", async () => {
    const router = routerAt(`/chat/${FIRST}`)
    await using screen = await render(() => <RouterProvider router={router} />)
    const room = screen.getByTestId("room")
    await expect.element(room).toHaveTextContent(FIRST)

    router.history.push(`/chat/${SECOND}`)
    expect(useApp.activeThreadId()).toBe(SECOND)
    await expect.element(room).toHaveTextContent(SECOND)

    router.history.back()
    await expect.element(room).toHaveTextContent(FIRST)
  })

  it("ignores a chat path that is not a room id, and reads ?room on recipes", async () => {
    const router = routerAt("/chat/not-a-room")
    await using screen = await render(() => <RouterProvider router={router} />)
    const room = screen.getByTestId("room")
    await expect.element(room).toHaveTextContent("none")

    router.history.push(`/recipes?room=${SECOND}`)
    await expect.element(room).toHaveTextContent(SECOND)

    router.history.push("/recipes")
    await expect.element(room).toHaveTextContent("none")
  })
})
