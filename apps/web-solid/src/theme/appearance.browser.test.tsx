import "../index.css"
import { describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import Appearance from "./appearance"
import { look, updateLook } from "./live"
import mono from "../fonts/geist-mono-core.woff2?url"
import sans from "../fonts/geist-core.woff2?url"

async function install(family: string, url: string) {
  const face = new FontFace(family, `url(${url})`)
  document.fonts.add(await face.load())
}

const familyOf = (element: Element) => getComputedStyle(element).fontFamily

async function typeFont(label: string, name: string) {
  const field = page.getByRole("textbox", { name: label })
  await field.clear()
  await field.fill(name)
  await userEvent.keyboard("{Enter}")
}

describe("appearance fonts", () => {
  it("applies an installed interface and code font and keeps the current font for an unknown name", async () => {
    await install("KikoTestSans", sans)
    await install("KikoTestMono", mono)
    await using screen = await render(() => (
      <>
        <Appearance />
        <p data-testid="ui-text">Hello</p>
        <code data-testid="code-text">const x = 1</code>
      </>
    ))
    const uiText = screen.getByTestId("ui-text")
    const codeText = screen.getByTestId("code-text")
    const uiBefore = familyOf(uiText.element())
    const codeBefore = familyOf(codeText.element())

    await typeFont("Interface font", "KikoTestSa")
    await expect.element(page.getByRole("textbox", { name: "Interface font" })).toHaveAttribute("aria-invalid", "true")
    expect(familyOf(uiText.element())).toBe(uiBefore)

    await typeFont("Interface font", "KikoTestSans")
    await expect.element(uiText).toHaveStyle({ fontFamily: `KikoTestSans, ${uiBefore}` })
    await expect.element(page.getByRole("textbox", { name: "Interface font" })).not.toHaveAttribute("aria-invalid")

    await typeFont("Code font", "KikoTestMono")
    await expect.element(codeText).toHaveStyle({ fontFamily: `KikoTestMono, ${codeBefore}` })

    await screen.getByRole("button", { name: "Reset interface font to default" }).click()
    await expect.element(uiText).toHaveStyle({ fontFamily: uiBefore })
    await screen.getByRole("button", { name: "Reset code font to default" }).click()
    await expect.element(codeText).toHaveStyle({ fontFamily: codeBefore })
  })
})

describe("appearance themes", () => {
  it("shows only the themes for the mode in view and lets System keep one light and one dark pick", async () => {
    updateLook({ mode: "dark", darkTheme: "dark" })
    await using screen = await render(() => <Appearance />)
    const dark = screen.getByRole("radiogroup", { name: "Dark theme" })
    await expect.element(dark.getByRole("radio", { name: "Dark High Contrast" })).toBeVisible()
    await expect.element(screen.getByRole("radio", { name: "Light High Contrast" })).not.toBeInTheDocument()

    await screen.getByRole("radio", { name: "Light", exact: true }).click()
    const light = screen.getByRole("radiogroup", { name: "Light theme" })
    await expect
      .element(light.getByRole("radio", { name: "Light", exact: true }))
      .toHaveAttribute("aria-checked", "true")
    await expect.element(screen.getByRole("radio", { name: "Dark High Contrast" })).not.toBeInTheDocument()

    await screen.getByRole("radio", { name: "System", exact: true }).click()
    await expect.element(screen.getByRole("radiogroup", { name: "Light theme" })).toBeVisible()
    await screen
      .getByRole("radiogroup", { name: "Dark theme" })
      .getByRole("radio", { name: "Dark High Contrast" })
      .click()
    expect(look().mode).toBe("system")
    expect(look().darkTheme).toBe("dark-high-contrast")
    await expect
      .element(
        screen.getByRole("radiogroup", { name: "Dark theme" }).getByRole("radio", { name: "Dark High Contrast" }),
      )
      .toHaveAttribute("aria-checked", "true")
    await expect
      .element(
        screen.getByRole("radiogroup", { name: "Light theme" }).getByRole("radio", { name: "Light", exact: true }),
      )
      .toHaveAttribute("aria-checked", "true")
  })

  it("keeps More themes as the last tile", async () => {
    updateLook({ mode: "dark", darkTheme: "dark" })
    await using screen = await render(() => <Appearance />)
    const grid = screen.getByRole("radiogroup", { name: "Dark theme" }).element().parentElement!
    expect(grid.lastElementChild).toBe(screen.getByRole("button", { name: "More themes" }).element())
  })
})
