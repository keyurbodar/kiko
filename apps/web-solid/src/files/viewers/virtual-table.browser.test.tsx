import "../../index.css"
import { expect, it } from "vitest"
import { render } from "../../../test/render"
import { LargeTextViewer } from "./large-text"

function blobUrl(text: string, type = "text/plain"): string {
  return URL.createObjectURL(new Blob([text], { type }))
}

function csv(rows: number): string {
  const lines = ["id,name,note"]
  for (let index = 1; index <= rows; index++) lines.push(`${index},"Item ${index}","A note for row ${index}"`)
  return lines.join("\n")
}

it("virtualizes a ten thousand row table and keeps the header and counts", async () => {
  const text = csv(10_000)
  const url = blobUrl(text, "text/csv")
  try {
    const container = document.createElement("div")
    container.style.cssText = "display:flex;width:900px;height:600px"
    await using screen = await render(
      () => <LargeTextViewer name="trip.csv" src={url} size={text.length} delimiter="," />,
      { container },
    )
    await expect.element(screen.getByText("10,000 rows, 3 columns")).toBeVisible()
    expect(screen.container.querySelectorAll("[data-preview-row]").length).toBeLessThan(100)
    const header = screen.container.querySelector('[role="columnheader"]')
    expect(header?.textContent).toBe("id")
    expect(screen.container.querySelector('[role="columnheader"][aria-colindex="3"]')?.textContent).toBe("note")
    expect(screen.container.textContent).toContain("Item 1")
    expect(screen.container.textContent).not.toContain("Item 9000")
  } finally {
    URL.revokeObjectURL(url)
  }
})

it("opens a file over one megabyte as numbered lines", async () => {
  const text = Array.from({ length: 120_000 }, (_, index) => `line ${index + 1}`).join("\n")
  expect(text.length).toBeGreaterThan(1024 * 1024)
  const url = blobUrl(text)
  try {
    const container = document.createElement("div")
    container.style.cssText = "display:flex;width:900px;height:600px"
    await using screen = await render(
      () => <LargeTextViewer name="build.log" src={url} size={text.length} delimiter={null} />,
      { container },
    )
    await expect.element(screen.getByText("120,000 lines")).toBeVisible()
    expect(screen.container.querySelectorAll("[data-preview-row]").length).toBeLessThan(100)
    const numbers = [...screen.container.querySelectorAll("[data-row-number]")].map((node) => node.textContent)
    expect(numbers[0]).toBe("1")
    expect(screen.container.querySelector('[role="region"]')?.textContent).toContain("line 1")
  } finally {
    URL.revokeObjectURL(url)
  }
})
