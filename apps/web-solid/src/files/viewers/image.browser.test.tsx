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

it("fits, zooms, and pans the picture around the pointer", async () => {
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

    const region = screen.container.querySelector<HTMLElement>('[role="region"]')!
    region.querySelector("img")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    expect(chip(screen.container)).toBe("100%")

    await screen.getByRole("button", { name: "Fit image" }).click()
    expect(chip(screen.container)).toBe("47%")
    await screen.getByRole("button", { name: "Actual size" }).click()
    expect(chip(screen.container)).toBe("100%")

    const bounds = region.getBoundingClientRect()
    region.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -400,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(Number.parseInt(chip(screen.container)!, 10)).toBeGreaterThan(100)
    expect(region.scrollWidth).toBeGreaterThan(region.clientWidth)

    region.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        bubbles: true,
      }),
    )
    const before = region.scrollLeft
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: bounds.left + bounds.width / 2 - 120,
        clientY: bounds.top + bounds.height / 2,
        bubbles: true,
      }),
    )
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }))
    expect(region.scrollLeft).toBeGreaterThan(before + 60)
  } finally {
    URL.revokeObjectURL(url)
  }
})
