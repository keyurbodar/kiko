import "../../index.css"
import JSZip from "jszip"
import { expect, it } from "vitest"
import { render } from "../../../test/render"
import BinaryViewer from "./binary"

function sized(width: number, height: number): HTMLElement {
  const container = document.createElement("div")
  container.style.cssText = `display:flex;width:${width}px;height:${height}px`
  return container
}

it("lists the entries of a zip archive with sizes", async () => {
  const zip = new JSZip()
  zip.file("readme.txt", "hello")
  zip.folder("trip")!.file("plan.md", "# Plan")
  zip.folder("trip")!.file("budget.csv", "a,b\n1,2\n")
  const blob = await zip.generateAsync({ type: "blob" })
  const url = URL.createObjectURL(blob)
  try {
    await using screen = await render(
      () => <BinaryViewer src={url} name="trip.zip" kind="archive" size={blob.size} />,
      { container: sized(900, 600) },
    )
    await expect.element(screen.getByText(/4 entries,/)).toBeVisible()
    const rows = [...screen.container.querySelectorAll("tbody tr")].map((row) => row.textContent)
    expect(rows[0]).toContain("trip/")
    expect(rows.some((row) => row?.includes("plan.md") && row.includes("6 B"))).toBe(true)
    expect(rows.some((row) => row?.includes("readme.txt"))).toBe(true)
  } finally {
    URL.revokeObjectURL(url)
  }
})

it("shows an unknown file as a virtualized hex dump", async () => {
  const bytes = new Uint8Array(1024 * 1024)
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
  const url = URL.createObjectURL(new Blob([bytes]))
  try {
    await using screen = await render(() => <BinaryViewer src={url} name="disk.img" kind="hex" size={bytes.length} />, {
      container: sized(900, 600),
    })
    await expect.element(screen.getByText("1.0 MB")).toBeVisible()
    expect(screen.container.querySelectorAll("[data-hex-offset]").length).toBeLessThan(100)
    expect(screen.container.querySelector("[data-hex-offset]")?.textContent).toBe("00000000")
    expect(screen.container.querySelector("[data-hex-bytes]")?.textContent?.startsWith("00 01 02 03")).toBe(true)
  } finally {
    URL.revokeObjectURL(url)
  }
})
