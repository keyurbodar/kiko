import { expect, test } from "bun:test"
import { chatImages } from "./chat-images"

const file = (name: string, type = "image/png") => ({ src: `/f/${name}`, name, type })

test("the arrows walk every picture of the chat, in order, from the one clicked", () => {
  const messages = [{ files: [file("a.png"), file("doc.pdf", "application/pdf")] }, {}, { files: [file("b.png"), file("c.png")] }]
  const { images, index } = chatImages(messages, { src: "/f/b.png", name: "b.png" })
  expect(images.map((i) => i.name)).toEqual(["a.png", "b.png", "c.png"])
  expect(index).toBe(1)
})

test("a picture the chat's messages do not hold opens alone", () => {
  const one = { src: "/other/x.png", name: "x.png" }
  expect(chatImages([{ files: [file("a.png")] }], one)).toEqual({ images: [one], index: 0 })
})
