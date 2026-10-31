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
import { closeDesk, deskShown, toggleDesk } from "../chat/side/surfaces"
import { room } from "../state/room"
import { Shell } from "./shell"
import { CHAT_MIN, defaultWidth, INFO, RAIL, SIDEBAR } from "./widths"

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

const MAX_FRAMES = 120

const FRAME_MS = 1000 / 60

const chatLeft = (container: HTMLElement) =>
  Math.round(container.querySelector<HTMLElement>('[data-component="chat-panel"]')!.getBoundingClientRect().left)

const slideTransitions = () =>
  document
    .getAnimations()
    .filter(
      (animation): animation is CSSTransition =>
        animation instanceof CSSTransition && animation.transitionProperty === "flex-basis",
    )

function sampleChatLeft(container: HTMLElement, end: number) {
  const transitions = slideTransitions()
  for (const transition of transitions) transition.pause()
  const samples: number[] = []
  for (let frame = 0; frame < MAX_FRAMES && samples.at(-1) !== end; frame += 1) {
    for (const transition of transitions) transition.currentTime = frame * FRAME_MS
    samples.push(chatLeft(container))
  }
  for (const transition of transitions) transition.play()
  return samples
}

const movesOneWay = (samples: number[], direction: 1 | -1) =>
  samples.slice(1).every((value, index) => direction * (value - samples[index]!) >= 0)

const slideDurationMs = () =>
  slideTransitions().map((transition) => transition.effect?.getComputedTiming().duration ?? 0)

describe("shell", () => {
  it("opens with the right panel closed and the sidebar at its default width on a first sign-in", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    closeDesk()
    room.followRoute(() => null)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "sidebar-panel")).toBe(defaultWidth(SIDEBAR))
    expect(screen.container.querySelector('[data-component="right-panel-host"]')).toBeNull()
  })

  it("slides the chat column between the rail and the sidebar without a jump", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    closeDesk()
    room.followRoute(() => null)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    const expanded = defaultWidth(SIDEBAR)
    const toggle = () => screen.container.querySelector<HTMLElement>('[data-component="sidebar-toggle"]')!.click()
    const railShown = () => screen.container.querySelector('[data-component="sidebar-rail"]') !== null
    const sidebarShown = () => screen.container.querySelector('[data-component="sidebar"]') !== null

    await expect.poll(() => width(screen.container, "sidebar-panel")).toBe(expanded)
    expect(railShown()).toBe(false)

    toggle()
    expect(slideDurationMs()).toEqual([200, 200])
    expect(railShown()).toBe(true)
    expect(sidebarShown()).toBe(false)
    const closing = sampleChatLeft(screen.container, RAIL)
    expect(closing.at(-1)).toBe(RAIL)
    expect(closing.every((left) => left >= RAIL && left <= expanded)).toBe(true)
    expect(movesOneWay(closing, -1)).toBe(true)

    toggle()
    const opening = sampleChatLeft(screen.container, expanded)
    expect(opening.at(-1)).toBe(expanded)
    expect(opening.every((left) => left >= RAIL && left <= expanded)).toBe(true)
    expect(movesOneWay(opening, 1)).toBe(true)
    expect(railShown()).toBe(false)
    expect(sidebarShown()).toBe(true)
  })

  it("lays the sidebar and the rail on Cursor's row grid", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    closeDesk()
    room.followRoute(() => null)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    const box = (selector: string) => screen.container.querySelector(selector)!.getBoundingClientRect()
    await expect.poll(() => width(screen.container, "sidebar-panel")).toBe(280)
    expect(box(".panel-header").height).toBe(40)
    expect(box('[data-component="top-bar"]').height).toBe(40)
    const add = box('[data-component="sidebar-add"]')
    const search = box('[data-component="sidebar-search"]')
    expect([add.left, add.width, add.height, search.top - add.top]).toEqual([8, 264, 32, 33])
    expect(box('[data-component="sidebar-header-search"]').height).toBe(24)

    screen.container.querySelector<HTMLElement>('[data-component="sidebar-toggle"]')!.click()
    await expect.poll(() => width(screen.container, "sidebar-panel")).toBe(RAIL)
    const items = [
      ...screen.container.querySelectorAll(
        '[data-component="sidebar-rail"] [aria-label="New chat"], [data-component="sidebar-rail"] [aria-label="Search"]',
      ),
    ].map((el) => el.getBoundingClientRect())
    expect(items.map((item) => [item.left, item.width])).toEqual([
      [10, 28],
      [10, 28],
    ])
    expect(items[1]!.top - items[0]!.top).toBe(33)
  })

  it("opens collapsed at the rail width once the owner has hidden the sidebar", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    localStorage.setItem("kiko:device:sidebar-collapsed", "1")
    closeDesk()
    room.followRoute(() => null)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "sidebar-panel")).toBe(RAIL)
    expect(screen.container.querySelector('[data-component="sidebar-rail"]')).not.toBeNull()
    expect(screen.container.querySelector('[data-component="sidebar"]')).toBeNull()

    await screen.getByRole("button", { name: "Toggle sidebar" }).click()
    await expect.poll(() => width(screen.container, "sidebar-panel")).toBe(defaultWidth(SIDEBAR))
    expect(screen.container.querySelector('[data-component="sidebar-rail"]')).toBeNull()
  })

  it("opens the right panel inline beside the chat column at its default width", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    if (!deskShown()) toggleDesk()
    room.followRoute(() => null)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "right-panel-host")).toBe(defaultWidth(INFO))
    const host = screen.container.querySelector<HTMLElement>('[data-component="right-panel-host"]')!
    expect(host.parentElement?.dataset.component).toBe("workspace-row")
    expect(host.previousElementSibling?.getAttribute("data-component")).toBe("main-column")
    expect(width(screen.container, "sidebar-panel")).toBe(defaultWidth(SIDEBAR))
    expect(screen.container.querySelector('[data-component="sidecar-overlay"]')).toBeNull()
    expect(screen.container.querySelector('[data-component="sidecar-scrim"]')).toBeNull()
  })

  it("docks a wide right panel beside the chat instead of floating it over a dimmed chat", async () => {
    await page.viewport(1100, 800)
    localStorage.clear()
    localStorage.setItem(INFO.key, "1000")
    if (!deskShown()) toggleDesk()
    room.followRoute(() => ROOM)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "main-column")).toBe(CHAT_MIN)
    expect(screen.container.querySelector('[data-component="sidecar-overlay"]')).toBeNull()
    expect(screen.container.querySelector('[data-component="sidecar-scrim"]')).toBeNull()
    expect(width(screen.container, "sidebar-panel")).toBe(defaultWidth(SIDEBAR))
    expect(width(screen.container, "right-panel-host")).toBe(1100 - defaultWidth(SIDEBAR) - CHAT_MIN)
  })

  it("maximizes the right panel over the chat column and leaves the sidebar width alone", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    if (!deskShown()) toggleDesk()
    room.followRoute(() => ROOM)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "right-panel-host")).toBe(defaultWidth(INFO))
    const sidebar = width(screen.container, "sidebar-panel")
    await screen.getByRole("button", { name: "Maximize panel" }).click()

    await expect.poll(() => width(screen.container, "right-panel-host")).toBe(1440 - sidebar)
    expect(width(screen.container, "sidebar-panel")).toBe(sidebar)
    expect(width(screen.container, "main-column")).toBe(0)
    expect(screen.container.querySelector('[data-component="main-column"]')!.hasAttribute("inert")).toBe(true)
    expect(screen.container.querySelector('[data-component="sidecar-overlay"]')).toBeNull()

    await screen.getByRole("button", { name: "Restore panel" }).click()
    await expect.poll(() => width(screen.container, "right-panel-host")).toBe(defaultWidth(INFO))
    expect(screen.container.querySelector('[data-component="main-column"]')!.hasAttribute("inert")).toBe(false)
  })

  it("resizes the right panel from its left edge and remembers the width", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    if (!deskShown()) toggleDesk()
    room.followRoute(() => ROOM)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "right-panel-host")).toBe(defaultWidth(INFO))
    const handle = screen.container.querySelector<HTMLElement>('[data-component="sidecar-resize"]')!
    handle.focus()
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))

    await expect.poll(() => width(screen.container, "right-panel-host")).toBe(defaultWidth(INFO) + 32)
    expect(localStorage.getItem(INFO.key)).toBe(String(defaultWidth(INFO) + 32))
    expect(width(screen.container, "sidebar-panel")).toBe(defaultWidth(SIDEBAR))
  })

  it("shows the right panel as a sheet at 980px and below", async () => {
    await page.viewport(960, 800)
    localStorage.clear()
    room.followRoute(() => ROOM)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await screen.getByRole("button", { name: "Files" }).first().click()
    await expect.poll(() => screen.container.querySelector('[data-component="sidecar-overlay"]') !== null).toBe(true)
    expect(screen.container.querySelector('[data-component="right-panel-host"]')).toBeNull()
  })
})
