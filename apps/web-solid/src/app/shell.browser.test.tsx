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
import { defaultWidth, INFO, RAIL, SIDEBAR } from "./widths"

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
    expect(Math.max(0, width(screen.container, "sidecar-column"))).toBe(0)
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
    const closing = sampleChatLeft(screen.container, RAIL)
    expect(closing.at(-1)).toBe(RAIL)
    expect(closing.every((left) => left >= RAIL && left <= expanded)).toBe(true)
    expect(movesOneWay(closing, -1)).toBe(true)
    await expect.poll(railShown).toBe(true)
    expect(sidebarShown()).toBe(false)

    toggle()
    const opening = sampleChatLeft(screen.container, expanded)
    expect(opening.at(-1)).toBe(expanded)
    expect(opening.every((left) => left >= RAIL && left <= expanded)).toBe(true)
    expect(movesOneWay(opening, 1)).toBe(true)
    expect(railShown()).toBe(false)
    expect(sidebarShown()).toBe(true)
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

  it("opens the right panel at its default width once the owner has opened it", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    if (!deskShown()) toggleDesk()
    room.followRoute(() => null)
    const router = firstSignIn()
    await using screen = await render(() => <RouterProvider router={router} />)

    await expect.poll(() => width(screen.container, "sidecar-column")).toBe(defaultWidth(INFO))
    expect(width(screen.container, "sidebar-panel")).toBe(defaultWidth(SIDEBAR))
  })

  it("maximizes the right panel over the chat column and leaves the sidebar width alone", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    if (!deskShown()) toggleDesk()
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
