import "../index.css"
import { describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import Appearance from "./appearance"
import display from "../../../landing/public/fonts/bricolage-grotesque-latin.woff2?url"
import sans from "../../../landing/public/fonts/figtree-latin.woff2?url"

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
    await install("KikoTestDisplay", display)
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

    await typeFont("Code font", "KikoTestDisplay")
    await expect.element(codeText).toHaveStyle({ fontFamily: `KikoTestDisplay, ${codeBefore}` })

    await screen.getByRole("button", { name: "Reset interface font to default" }).click()
    await expect.element(uiText).toHaveStyle({ fontFamily: uiBefore })
    await screen.getByRole("button", { name: "Reset code font to default" }).click()
    await expect.element(codeText).toHaveStyle({ fontFamily: codeBefore })
  })
})
