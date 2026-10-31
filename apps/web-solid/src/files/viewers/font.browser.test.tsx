import "../../index.css"
import { expect, it } from "vitest"
import { render } from "../../../test/render"
import geist from "../../fonts/geist-core.woff2?url"
import FontViewer from "./font"

it("shows a font specimen with its family and several sizes", async () => {
  const container = document.createElement("div")
  container.style.cssText = "display:flex;width:900px;height:600px"
  await using screen = await render(
    () => <FontViewer name="geist-latin-wght-normal.woff2" src={geist} size={120_000} />,
    { container },
  )
  await expect.element(screen.getByRole("heading", { name: "geist-latin-wght-normal" })).toBeVisible()
  for (const size of ["12 px", "16 px", "24 px", "40 px", "64 px"])
    await expect.element(screen.getByText(size)).toBeVisible()
  expect(screen.container.textContent).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
  expect(screen.container.textContent).toContain("The quick brown fox jumps over the lazy dog.")
  const specimen = screen.container.querySelector<HTMLElement>('[data-component="file-font"] p')
  expect(getComputedStyle(specimen!).fontFamily).toBe("KikoFilePreview")
})
