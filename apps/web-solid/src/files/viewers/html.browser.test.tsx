import "../../index.css"
import { expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import HtmlView from "./html"

const PAGE = "<!doctype html><html><body><h1>Hello from a file</h1></body></html>"

it("runs an HTML file in a sandboxed frame that may download", async () => {
  const real = globalThis.fetch
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith("blob:") ? real(input, init) : new Response(PAGE, { status: 200 }),
  )
  try {
    const container = document.createElement("div")
    container.style.cssText = "display:flex;width:900px;height:600px"
    await using screen = await render(
      () => <HtmlView roomId="home" file={{ id: "file-1", name: "page.html", size: PAGE.length, type: "text/html" }} />,
      { container },
    )
    await expect.element(screen.getByTitle("page.html")).toBeVisible()
    const frame = screen.container.querySelector("iframe")!
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-popups allow-downloads")
    expect(frame.getAttribute("title")).toBe("page.html")
    expect(frame.src.startsWith("blob:")).toBe(true)
    expect(await (await real(frame.src)).text()).toContain("Hello from a file")
  } finally {
    vi.unstubAllGlobals()
  }
})
