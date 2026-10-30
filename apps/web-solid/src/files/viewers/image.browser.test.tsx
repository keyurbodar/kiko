import "../../index.css"
import { expect, it } from "vitest"
import { render } from "../../../test/render"
import ImageViewer from "./image"

function png(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")!
  context.fillStyle = "#3b7ff0"
  context.fillRect(0, 0, width, height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No image"))), "image/png"),
  )
}

const chip = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-component="image-zoom-chip"]')?.textContent

it("fits and zooms the picture from the toolbar, and opens it in the lightbox on click", async () => {
  const url = URL.createObjectURL(await png(1200, 600))
  try {
    const container = document.createElement("div")
    container.style.cssText = "display:flex;width:600px;height:400px"
    await using screen = await render(() => <ImageViewer src={url} name="trip.png" />, { container })
    await expect.element(screen.getByText("1,200 × 600")).toBeVisible()
    expect(chip(screen.container)).toBe("47%")

    await screen.getByRole("button", { name: "Zoom in" }).click()
    expect(chip(screen.container)).toBe("59%")
    await screen.getByRole("button", { name: "Zoom out" }).click()
    expect(chip(screen.container)).toBe("47%")
    await screen.getByRole("button", { name: "Actual size" }).click()
    expect(chip(screen.container)).toBe("100%")
    await screen.getByRole("button", { name: "Fit image" }).click()
    expect(chip(screen.container)).toBe("47%")

    await screen.getByRole("button", { name: "Zoom trip.png" }).click()
    const dialog = screen.getByRole("dialog")
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog.getByRole("img", { name: "trip.png" })).toBeVisible()
    await dialog.getByRole("button", { name: "Close image preview" }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(chip(screen.container)).toBe("47%")
  } finally {
    URL.revokeObjectURL(url)
  }
})
