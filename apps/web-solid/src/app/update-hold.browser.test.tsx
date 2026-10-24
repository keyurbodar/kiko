import { PROTOCOL } from "@kiko/protocol"
import { RouterProvider } from "@tanstack/solid-router"
import { describe, expect, it } from "vitest"
import { render } from "../../test/render"
import { chatRouter, editable, fakeBackend } from "../../test/update-backend"
import { APP_VERSION } from "../lib/version-skew"
import { refreshBackend, startUpdate } from "./update-flow"

describe("a backend updating to a new protocol", () => {
  it("holds the chats read-only behind one calm line, then lifts once the backend matches", async () => {
    using backend = fakeBackend({ kiko: 1, version: APP_VERSION, protocol: PROTOCOL - 1, selfUpdate: true })
    await using screen = await render(() => <RouterProvider router={chatRouter()} />)
    const sendBlock = () => screen.container.querySelector('[data-component="composer-send-block"]')
    const pill = () => screen.container.querySelector('[data-component="update-pill"]')?.textContent ?? null
    await expect.poll(() => editable(screen.container)).toBe(true)
    expect(sendBlock()).not.toBeNull()

    await refreshBackend()
    await expect.element(screen.getByText("Checking your backend…")).toBeVisible()
    await startUpdate()
    await expect.element(screen.getByText("Updating your backend…")).toBeVisible()
    expect(backend.started).toEqual([APP_VERSION])
    expect(editable(screen.container)).toBe(false)
    expect(screen.container.querySelectorAll('[data-component="update-notice"]')).toHaveLength(1)
    expect(sendBlock()).toBeNull()
    expect(screen.container.querySelector('[data-component="update-notice"] button')).toBeNull()
    expect(pill()).toBe("Updating")

    backend.descriptor = { kiko: 1, version: APP_VERSION, protocol: PROTOCOL, selfUpdate: true }
    await refreshBackend()
    await expect.poll(() => editable(screen.container)).toBe(true)
    expect(screen.container.querySelector('[data-component="update-notice"]')).toBeNull()
    expect(sendBlock()).not.toBeNull()
    await expect.poll(pill).toBeNull()
  })
})
