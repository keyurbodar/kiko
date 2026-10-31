import "../index.css"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"

const created: Array<{ title: string; ids: readonly string[] }> = []

vi.mock("../state/user", () => ({
  user: {
    agents: () => [{ id: "juno", slug: "juno", name: "Juno" }],
    createChat: (title: string, ids: readonly string[]) => {
      created.push({ title, ids })
      return "room-1"
    },
  },
}))
vi.mock("../app/history", () => ({ openChat: () => {} }))
vi.mock("../newagent/state", () => ({ openNewAgent: () => {} }))

const { default: BotPicker } = await import("./bot-picker")

describe("BotPicker", () => {
  it("keeps exactly one row highlighted as the keyboard moves", async () => {
    created.length = 0
    await using _screen = await render(() => <BotPicker />)
    await expect.element(page.getByRole("option", { selected: true, name: /^Kiko/ })).toBeVisible()
    await userEvent.keyboard("{ArrowDown}")
    await expect.element(page.getByRole("option", { selected: true, name: /^Juno/ })).toBeVisible()
    expect(document.querySelectorAll('[cmdk-item][data-selected="true"]')).toHaveLength(1)
  })

  it("changes the footer label with the picks and starts a group", async () => {
    created.length = 0
    await using _screen = await render(() => <BotPicker />)
    await expect.element(page.getByRole("button", { name: "Start chat" })).toBeVisible()
    await userEvent.keyboard("{ArrowDown}{ }")
    await expect.element(page.getByRole("button", { name: "Chat with Juno" })).toBeVisible()
    await userEvent.keyboard("{ArrowUp}{ }")
    await expect.element(page.getByRole("button", { name: "Start group" })).toBeVisible()
    await page.getByRole("button", { name: "Start group" }).click()
    expect(created).toEqual([{ title: "Kiko, Juno", ids: ["kiko", "juno"] }])
  })

  it("opens a 1:1 chat on Enter when nothing is checked", async () => {
    created.length = 0
    await using _screen = await render(() => <BotPicker />)
    await userEvent.keyboard("{ArrowDown}{Enter}")
    expect(created).toEqual([{ title: "Juno", ids: ["juno"] }])
  })

  it("ignores Enter that commits an IME composition in the group name field", async () => {
    created.length = 0
    await using _screen = await render(() => <BotPicker />)
    await userEvent.keyboard("{ArrowDown}{ }{ArrowUp}{ }")
    const field = page.getByRole("textbox", { name: "Group name" })
    await expect.element(field).toBeVisible()
    field.element().focus()
    field.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }))
    expect(created).toEqual([])
    field.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(created).toEqual([{ title: "Kiko, Juno", ids: ["kiko", "juno"] }])
  })
})
