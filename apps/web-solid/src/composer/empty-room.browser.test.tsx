import "../index.css"
import { describe, expect, it } from "vitest"
import { render } from "../../test/render"
import type { RosterBot } from "../lib/types"
import { Composer } from "./composer"

const ROOM = "01900000-0000-7000-8000-000000000042"

const BOT: RosterBot = {
  id: "kiko",
  name: "Kiko",
  preview: "",
  updatedAt: 0,
  presence: "idle",
  unread: 0,
  pinned: false,
}

const mount = (empty: boolean) =>
  render(() => <Composer threadId={ROOM} bots={[BOT]} empty={empty} onSend={() => {}} />)

describe("composer in a room", () => {
  it("teaches the mention hint and shows the disclaimer only before the first message", async () => {
    await using screen = await mount(true)
    await expect.poll(() => screen.container.querySelector(".ProseMirror"), { timeout: 10_000 }).not.toBeNull()
    expect(screen.container.querySelector(".composer-placeholder")?.textContent).toBe(
      "Message Kiko. @ to mention, / for skills",
    )
    expect(screen.container.querySelector(".composer-disclaimer")?.textContent).toBe(
      "Kiko is AI and can make mistakes.",
    )
  })

  it("drops the hint and the disclaimer once the room has messages", async () => {
    await using screen = await mount(false)
    await expect.poll(() => screen.container.querySelector(".ProseMirror"), { timeout: 10_000 }).not.toBeNull()
    expect(screen.container.querySelector(".composer-placeholder")?.textContent).toBe("Message Kiko")
    expect(screen.container.querySelector(".composer-disclaimer")).toBeNull()
  })
})
