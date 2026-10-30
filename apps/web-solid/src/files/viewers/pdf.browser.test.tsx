import "../../index.css"
import { expect, it } from "vitest"
import { render } from "../../../test/render"
import PdfViewer from "./pdf"

function twoPagePdf(): Blob {
  const pages = [
    { box: "0 0 612 140", rotate: 0, text: "BT /F1 24 Tf 30 70 Td (Quarterly outlook) Tj ET" },
    { box: "0 0 612 792", rotate: 0, text: "BT /F1 24 Tf 30 700 Td (Budget and risks) Tj ET" },
  ]
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>",
    ...pages.flatMap(({ box, rotate, text }, index) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [${box}] /Rotate ${rotate} /Resources << /Font << /F1 7 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    ]),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let source = "%PDF-1.4\n"
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(source.length)
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = source.length
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([source], { type: "application/pdf" })
}

it("fits the width, stacks pages and selects text", async () => {
  const url = URL.createObjectURL(twoPagePdf())
  try {
    const container = document.createElement("div")
    container.style.cssText = "display:flex;width:500px;height:600px"
    await using screen = await render(() => <PdfViewer src={url} title="Planning PDF" />, { container })
    await expect.element(screen.getByText("Page 1 of 2"), { timeout: 20_000 }).toBeVisible()
    const region = screen.container.querySelector<HTMLElement>('[role="region"]')!
    const canvas = region.querySelector<HTMLCanvasElement>('canvas[aria-label="Page 1"]')
    expect(canvas).not.toBeNull()
    await expect.element(screen.getByText("Fit width")).toBeVisible()
    const span = await new Promise<HTMLElement>((resolve) => {
      const found = region.querySelector<HTMLElement>("[data-pdf-text-layer] span")
      if (found) return resolve(found)
      const watch = new MutationObserver(() => {
        const node = region.querySelector<HTMLElement>("[data-pdf-text-layer] span")
        if (!node) return
        watch.disconnect()
        resolve(node)
      })
      watch.observe(region, { childList: true, subtree: true })
    })
    expect(span.textContent).toContain("Quarterly")
    expect(getComputedStyle(span).userSelect).toBe("text")

    await screen.getByRole("button", { name: "Next page" }).click()
    await expect.element(screen.getByText("Page 2 of 2")).toBeVisible()
    expect(region.querySelector('canvas[aria-label="Page 2"]')).not.toBeNull()

    await screen.getByRole("button", { name: "Zoom in" }).click()
    expect(screen.container.querySelector(".min-w-14")?.textContent).toMatch(/^\d+%$/)
    expect(region.scrollWidth).toBeGreaterThan(region.clientWidth)
  } finally {
    URL.revokeObjectURL(url)
  }
})
