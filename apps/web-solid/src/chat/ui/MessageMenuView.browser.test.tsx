import "../../index.css"
import { describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../../test/render"
import type { ChatMessage } from "../../lib/types"
import MessageMenu from "./MessageMenuView"

const message = {
  id: "1.room",
  threadId: "room",
  sender: "bot",
  botId: "kiko",
  body: "Hello",
  sentAt: 0,
  seq: 1,
} as ChatMessage

function Harness() {
  return (
    <>
      <button type="button" aria-label="More" data-action="more">
        More
      </button>
      <MessageMenu message={message} side="bot" onReply={() => {}} onReact={() => {}} />
    </>
  )
}

const openFrom = async (more: HTMLElement) => {
  more.focus()
  await expect.element(more).toHaveFocus()
  const trigger = document.querySelector<HTMLElement>(".chat-menu__trigger")!
  trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
  await expect.element(page.getByRole("menuitem", { name: "Reply" })).toBeVisible()
}

describe("message menu focus", () => {
  it("returns focus to the trigger after choosing an item", async () => {
    await using _screen = await render(Harness)
    const more = document.querySelector<HTMLElement>('[data-action="more"]')!
    await openFrom(more)
    await userEvent.click(page.getByRole("menuitem", { name: "Reply" }))
    await expect.element(more).toHaveFocus()
  })

  it("returns focus to the trigger after closing with Escape", async () => {
    await using _screen = await render(Harness)
    const more = document.querySelector<HTMLElement>('[data-action="more"]')!
    await openFrom(more)
    await userEvent.keyboard("{Escape}")
    await expect.element(more).toHaveFocus()
  })
})
