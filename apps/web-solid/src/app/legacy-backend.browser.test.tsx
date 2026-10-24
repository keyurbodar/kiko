import { PROTOCOL } from "@kiko/protocol"
import { RouterProvider } from "@tanstack/solid-router"
import { describe, expect, it } from "vitest"
import { render } from "../../test/render"
import { chatRouter, editable, fakeBackend } from "../../test/update-backend"
import { startUpdate } from "./update-flow"

describe("a backend from before the descriptor", () => {
  it("keeps the chats read-only with one way out, which reconnects Cloudflare", async () => {
    using backend = fakeBackend({ version: "0.7.8", protocol: PROTOCOL, storage: "built-in" })
    const router = chatRouter()
    await using screen = await render(() => <RouterProvider router={router} />)
    await expect.poll(() => editable(screen.container)).toBe(true)

    await startUpdate()
    await expect.element(screen.getByText("Your backend runs an older version of Kiko.")).toBeVisible()
    expect(editable(screen.container)).toBe(false)
    expect(backend.started).toEqual([])
    expect(screen.container.querySelectorAll('[data-component="update-notice"] button')).toHaveLength(1)

    await screen.getByRole("button", { name: "Sign in to Cloudflare" }).click()
    await expect.poll(() => router.state.location.pathname).toBe("/connect")
    expect(router.state.location.search).toEqual({ reconnect: 1 })
  })
})
