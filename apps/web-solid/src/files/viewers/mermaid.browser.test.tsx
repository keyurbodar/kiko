import "../../index.css"
import flow from "../../../test/fixtures/files/flow.mmd?raw"
import { expect, it } from "vitest"
import { render } from "../../../test/render"
import MermaidViewer, { safeDiagramSvg } from "./mermaid"

it("draws a mermaid file and flips to its source", async () => {
  await import("mermaid")
  const url = URL.createObjectURL(new Blob([flow], { type: "text/plain" }))
  try {
    const container = document.createElement("div")
    container.style.cssText = "display:flex;width:900px;height:600px"
    await using screen = await render(() => <MermaidViewer name="flow.mmd" src={url} size={flow.length} />, {
      container,
    })
    await expect.poll(() => screen.container.querySelector("[data-component='mermaid-diagram'] svg")).not.toBeNull()
    await expect.element(screen.getByText("Book")).toBeVisible()
    const pill = screen.container.querySelector<HTMLElement>(".pill-indicator")
    expect(pill?.getBoundingClientRect().height ?? 0).toBeLessThan(48)
    await screen.getByRole("tab", { name: "Source" }).click()
    await expect.element(screen.getByText(/graph LR/)).toBeVisible()
  } finally {
    URL.revokeObjectURL(url)
  }
})

it("drops scripts and remote links from rendered diagrams", () => {
  const clean = safeDiagramSvg(
    `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><a href="https://example.com"><text>x</text></a><a href="#here"><text>y</text></a></svg>`,
  )
  expect(clean).not.toContain("<script")
  expect(clean).not.toContain("https://example.com")
  expect(clean).toContain('href="#here"')
})
