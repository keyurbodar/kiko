import "../../index.css"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../../test/render"
import ImageDialog from "./ImageDialog"

const png = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

const images = [
  { src: png, name: "first.png" },
  { src: `${png}#2`, name: "second.png" },
]

const caption = () => document.querySelector('[data-component="image-dialog-caption"]')?.textContent

describe("ImageDialog", () => {
  it("opens at the clicked image and steps through only the images it was given", async () => {
    await using _screen = await render(() => <ImageDialog images={images} index={0} onClose={() => {}} />)

    await vi.waitFor(() => expect(caption()).toContain("first.png (1/2)"))
    await userEvent.keyboard("{ArrowRight}")
    await vi.waitFor(() => expect(caption()).toContain("second.png (2/2)"))
    await userEvent.keyboard("{ArrowRight}")
    await vi.waitFor(() => expect(caption()).toContain("first.png (1/2)"))
  })

  it("closes on Escape", async () => {
    const onClose = vi.fn()
    await using _screen = await render(() => <ImageDialog images={images} index={0} onClose={onClose} />)

    await userEvent.keyboard("{Escape}")

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("plays a video in the preview", async () => {
    await using _screen = await render(() => (
      <ImageDialog images={[{ src: "blob:clip", name: "clip.mp4", video: true }]} index={0} onClose={() => {}} />
    ))

    await vi.waitFor(() => expect(document.querySelector("video[controls]")).toBeTruthy())
    expect(document.querySelector('[data-component="image-dialog-viewport"]')).toBeNull()
  })
})
