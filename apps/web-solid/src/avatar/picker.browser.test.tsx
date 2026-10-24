import "../index.css"
import { describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../test/render"
import AvatarPicker from "./picker"
import { closeAvatarPicker, openAvatarPicker } from "./picker-state"

describe("avatar picker", () => {
  it("marks the generated flavor before anything is picked, then follows the pick", async () => {
    openAvatarPicker("juno")
    await using _screen = await render(() => <AvatarPicker />)
    const dialog = page.getByRole("dialog")
    await expect.element(dialog.getByRole("heading", { name: "Juno's look" })).toBeVisible()
    const flavors = dialog.getByRole("radiogroup", { name: "Flavor" })
    const checked = flavors.getByRole("radio", { checked: true })
    await expect.element(checked).toBeVisible()
    expect(checked.elements()).toHaveLength(1)

    const other = flavors.getByRole("radio", { checked: false }).first()
    const name = other.element().getAttribute("aria-label")!
    await other.click()
    await expect.element(checked).toHaveAccessibleName(name)
    closeAvatarPicker()
  })
})
