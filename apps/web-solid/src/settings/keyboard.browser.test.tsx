import "../index.css"
import { describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { bindings, resetAllKeys } from "../commands/bindings"
import { shortcutOf, useCommands, type Command } from "../commands/registry"
import KeyboardPage from "./keyboard"

const noop = () => {}

const ATTACH: Command = { id: "chat.attach", title: "Attach files", group: "chat", icon: "attach", run: noop }
const CLOSE: Command = {
  id: "chat.close",
  title: "Close chat",
  group: "chat",
  icon: "close",
  shortcut: "F2",
  run: noop,
}

function Page() {
  useCommands([ATTACH, CLOSE])
  return <KeyboardPage />
}

const freshKeys = () => ({ [Symbol.dispose]: resetAllKeys })

describe("keyboard shortcuts", () => {
  it("records from anywhere on the row and asks before taking a key from another command", async () => {
    using _keys = freshKeys()
    await using _screen = await render(() => <Page />)
    await page.getByRole("button", { name: "Change the shortcut for Attach files" }).click()
    await expect.element(page.getByText("Esc to cancel, Backspace to remove")).toBeVisible()
    await userEvent.keyboard("{F2}")

    await expect.element(page.getByText(/F2 already opens Close chat/)).toBeVisible()
    expect(shortcutOf(CLOSE)).toBe("F2")
    expect(bindings()["chat.attach"]).toBeUndefined()

    await page.getByRole("button", { name: "Use anyway" }).click()
    expect(bindings()["chat.attach"]).toBe("F2")
    expect(bindings()["chat.close"]).toBeNull()
    await expect.element(page.getByText(/F2 already opens Close chat/)).not.toBeInTheDocument()
  })

  it("cancels recording with Escape and keeps the old key", async () => {
    using _keys = freshKeys()
    await using _screen = await render(() => <Page />)
    await page.getByRole("button", { name: "Change the shortcut for Close chat" }).click()
    await userEvent.keyboard("{Escape}")
    await expect.element(page.getByRole("button", { name: "Change the shortcut for Close chat" })).toBeVisible()
    expect(shortcutOf(CLOSE)).toBe("F2")
  })
})
