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
import { landingSection, SETTINGS_SECTIONS } from "./sections"
import { SettingsDialog } from "./settings-dialog"

function routerAt(path: string) {
  const root = createRootRoute()
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    component: () => (
      <SettingsDialog>
        <Outlet />
      </SettingsDialog>
    ),
  })
  const sections = SETTINGS_SECTIONS.map((section) =>
    createRoute({
      getParentRoute: () => settings,
      path: section.id,
      component: () => <p data-testid="section-body">{section.id}</p>,
    }),
  )
  const chat = createRoute({ getParentRoute: () => root, path: "/chat", component: () => <p>Chat</p> })
  return createRouter({
    routeTree: root.addChildren([settings.addChildren(sections), chat]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

describe("settings routes", () => {
  it("opens a deep link on its section and moves between sections through the URL", async () => {
    await page.viewport(1280, 720)
    const router = routerAt("/settings/tools")
    await using screen = await render(() => <RouterProvider router={router} />)
    const dialog = page.getByRole("dialog")
    await expect.element(dialog.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible()
    await expect.element(screen.getByTestId("section-body")).toHaveTextContent("tools")
    await expect
      .element(dialog.getByRole("button", { name: "Tools", exact: true }))
      .toHaveAttribute("aria-current", "page")

    await dialog.getByRole("button", { name: "Appearance", exact: true }).click()
    expect(router.history.location.pathname).toBe("/settings/appearance")
    await expect.element(dialog.getByRole("heading", { name: "Appearance", level: 1 })).toBeVisible()
    await expect.element(screen.getByTestId("section-body")).toHaveTextContent("appearance")

    router.history.back()
    await expect.element(dialog.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible()
  })

  it("lists every section in the nav from the one registry", async () => {
    await page.viewport(1280, 720)
    const router = routerAt("/settings/models")
    await using _screen = await render(() => <RouterProvider router={router} />)
    const nav = page.getByRole("navigation", { name: "Settings sections" })
    for (const section of SETTINGS_SECTIONS)
      await expect.element(nav.getByRole("button", { name: section.label, exact: true })).toBeVisible()
  })

  it("on a phone shows the section list first, pushes a section, and goes back to the list", async () => {
    await page.viewport(390, 844)
    const router = routerAt("/settings")
    await using _screen = await render(() => <RouterProvider router={router} />)
    const dialog = page.getByRole("dialog")
    const tools = dialog.getByRole("button", { name: "Tools", exact: true })
    await expect.element(tools).toBeVisible()
    expect(router.history.location.pathname).toBe("/settings")

    await tools.click()
    expect(router.history.location.pathname).toBe("/settings/tools")
    await expect.element(dialog.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible()
    await expect.element(tools).not.toBeInTheDocument()

    await dialog.getByRole("button", { name: "Settings", exact: true }).click()
    expect(router.history.location.pathname).toBe("/settings")
    await expect.element(tools).toBeVisible()
  })

  it("on a wide screen opens the first section when no section is named", async () => {
    await page.viewport(1280, 720)
    const router = routerAt("/settings")
    await using _screen = await render(() => <RouterProvider router={router} />)
    await expect.element(page.getByRole("dialog").getByRole("heading", { name: "Models", level: 1 })).toBeVisible()
    expect(router.history.location.pathname).toBe("/settings/models")
  })

  it("stays closed when settings closes to a chat", async () => {
    await page.viewport(1280, 720)
    const router = routerAt("/settings/tools")
    await using screen = await render(() => <RouterProvider router={router} />)
    await expect.element(page.getByRole("dialog")).toBeVisible()
    await router.navigate({ to: "/chat" })
    await expect.element(screen.getByText("Chat")).toBeVisible()
    expect(router.history.location.pathname).toBe("/chat")
  })

  it("lands old section names and unknown ones on a real section", () => {
    expect(landingSection("providers")).toBe("models")
    expect(landingSection("skills")).toBe("tools")
    expect(landingSection("keyboard")).toBe("keyboard")
    expect(landingSection("nope")).toBe("models")
  })
})
