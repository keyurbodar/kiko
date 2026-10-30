import "../index.css"
import { expect, it } from "vitest"
import { render } from "../../test/render"
import { FileViewer } from "./viewer"

it("offers the download instead of a broken picture when the browser cannot decode an image", async () => {
  const container = document.createElement("div")
  container.style.cssText = "display:flex;width:600px;height:400px"
  await using screen = await render(
    () => (
      <FileViewer
        roomId="01900000-0000-7000-8000-000000000099"
        path="attachments/scan.tiff"
        file={{
          id: "01900000-0000-7000-8000-0000000000aa",
          name: "attachments/scan.tiff",
          size: 12,
          type: "image/tiff",
        }}
        kind="image"
        rendered={false}
        wrap={false}
        reveal={null}
      />
    ),
    { container },
  )
  await expect.element(screen.getByText("No preview for this file")).toBeVisible()
})
