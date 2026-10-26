import { ToastV2 } from "@kiko/ui/v2/toast-v2"
import { describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { connection } from "../state/connection"
import { room } from "../state/room"
import { Composer } from "./composer"

const ROOM = "01900000-0000-7000-8000-000000000003"

describe("sending while disconnected", () => {
  it("refuses the send, says so, and keeps the draft", async () => {
    room.followRoute(() => ROOM)
    expect(connection.connected()).toBe(false)
    let accepted: boolean | undefined
    await using screen = await render(() => (
      <>
        <Composer threadId={ROOM} bots={[]} onSend={(message) => (accepted = room.send(message) !== undefined)} />
        <ToastV2.Region />
      </>
    ))

    await expect
      .poll(() => screen.container.querySelector('[contenteditable="true"]'), { timeout: 10_000 })
      .not.toBeNull()
    const editor = screen.container.querySelector<HTMLElement>('[contenteditable="true"]')!
    await userEvent.click(editor)
    await userEvent.keyboard("see you at noon")
    await userEvent.keyboard("{Enter}")

    await expect.element(page.getByText("Not connected: message not sent")).toBeVisible()
    expect(accepted).toBe(false)
    expect(editor.textContent).toContain("see you at noon")
    expect(room.messages().some((m) => m.body === "see you at noon")).toBe(false)
  })
})
