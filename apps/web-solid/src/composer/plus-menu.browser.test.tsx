import "../index.css"
import type { Token } from "./tokens"
import type { Screen } from "../../test/render"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"

const { PlusMenu } = await import("./plus-menu")

const skill: Token = { kind: "skill", id: "sunset", name: "sunset", title: "Sunset", hint: "" }
const pools = {
  files: () => [] as Token[],
  apps: () => [] as Token[],
  skills: () => [skill],
  recipes: () => [] as Token[],
  agents: () => [] as Token[],
}

const renderMenu = (onInsert: (token: Token) => void) =>
  render(() => (
    <PlusMenu
      pools={pools}
      onInsert={onInsert}
      onAddFiles={() => {}}
      onAddSomeone={() => {}}
      onManageSkills={() => {}}
      onConnectApp={() => {}}
    />
  ))

const openSkills = async (screen: Screen) => {
  screen.container.style.marginTop = "calc(100vh - 60px)"
  await userEvent.click(page.getByRole("button", { name: "Add" }))
  await userEvent.click(page.getByRole("menuitem", { name: "Skills" }))
  return page.getByRole("textbox", { name: "Search skills" })
}

const caret = (field: ReturnType<typeof page.getByRole>) => (field.element() as HTMLInputElement).selectionStart ?? 0

describe("PlusMenu sub-panel", () => {
  it("moves the caret with ArrowLeft in the search field and only goes back at the start", async () => {
    await using _screen = await renderMenu(() => {})
    const field = await openSkills(_screen)
    await expect.element(field).toBeVisible()
    await userEvent.type(field, "ab")
    await expect.poll(() => caret(field)).toBe(2)
    await userEvent.keyboard("{ArrowLeft}")
    await expect.poll(() => caret(field)).toBe(1)
    await expect.element(field).toBeVisible()
    ;(field.element() as HTMLInputElement).setSelectionRange(0, 0)
    await userEvent.keyboard("{ArrowLeft}")
    await expect.poll(() => field.elements().length).toBe(0)
    await expect.element(page.getByRole("menuitem", { name: "Skills" })).toBeVisible()
  })

  it("still picks the highlighted skill with Enter", async () => {
    const insert = vi.fn()
    await using _screen = await renderMenu(insert)
    const field = await openSkills(_screen)
    await expect.element(field).toBeVisible()
    await userEvent.keyboard("{Enter}")
    expect(insert).toHaveBeenCalledWith(skill)
  })
})
