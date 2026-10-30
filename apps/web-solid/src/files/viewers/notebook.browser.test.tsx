import "../../index.css"
import notebook from "../../../test/fixtures/files/notebook.ipynb?raw"
import { expect, it } from "vitest"
import { render } from "../../../test/render"
import NotebookViewer from "./notebook"

it("shows notebook cells with rendered markdown, code and saved outputs", async () => {
  const url = URL.createObjectURL(new Blob([notebook], { type: "application/json" }))
  try {
    const container = document.createElement("div")
    container.style.cssText = "display:flex;width:900px;height:600px"
    await using screen = await render(() => <NotebookViewer name="trip.ipynb" src={url} size={notebook.length} />, {
      container,
    })
    await expect.element(screen.getByText("2 cells, python")).toBeVisible()
    await expect.element(screen.getByRole("heading", { name: "Trip plan" })).toBeVisible()
    expect(screen.container.textContent).toContain("Two nights in Lisbon")
    expect(screen.container.textContent).toContain("len(hotels)")
    expect(screen.container.textContent).toContain("hotels: 12")
    expect(screen.container.textContent).toContain("42")
    expect(screen.container.textContent).toContain("In [3]")
    expect(screen.container.textContent).toContain("Saved outputs only. Code is never executed.")
  } finally {
    URL.revokeObjectURL(url)
  }
})
