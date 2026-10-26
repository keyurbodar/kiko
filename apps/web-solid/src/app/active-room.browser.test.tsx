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
import { room } from "../state/room"
import { roomInUrl } from "./sections"

const FIRST = "01900000-0000-7000-8000-000000000001"
const SECOND = "01900000-0000-7000-8000-000000000002"

function routerAt(path: string) {
  const root = createRootRoute({
    component: () => {
      const location = useLocation()
      room.followRoute(() => roomInUrl(location().pathname, location().search))
      return (
        <>
          <output data-testid="room">{room.activeId() ?? "none"}</output>
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
    const shown = screen.getByTestId("room")
    await expect.element(shown).toHaveTextContent(FIRST)

    router.history.push(`/chat/${SECOND}`)
    expect(room.activeId()).toBe(SECOND)
    await expect.element(shown).toHaveTextContent(SECOND)

    router.history.back()
    await expect.element(shown).toHaveTextContent(FIRST)
  })

  it("ignores a chat path that is not a room id, and reads ?room on recipes", async () => {
    const router = routerAt("/chat/not-a-room")
    await using screen = await render(() => <RouterProvider router={router} />)
    const shown = screen.getByTestId("room")
    await expect.element(shown).toHaveTextContent("none")

    router.history.push(`/recipes?room=${SECOND}`)
    await expect.element(shown).toHaveTextContent(SECOND)

    router.history.push("/recipes")
    await expect.element(shown).toHaveTextContent("none")
  })
})
