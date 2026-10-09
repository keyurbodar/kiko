import { describe, expect, test } from "bun:test"
import { admit, attachmentType, isImage, MAX_FILES, splitFiles, tileSpan, wrapIndex } from "./attachments"

const MB = 1024 * 1024
const file = (name: string, type: string, size = 1000) => ({ name, type, size })

describe("which files are pictures", () => {
  test.each([
    ["a png", file("a.png", "image/png"), true],
    ["a jpeg", file("a.jpg", "image/jpeg"), true],
    ["a gif", file("a.gif", "image/gif"), true],
    ["a webp", file("a.webp", "image/webp"), true],
    ["a jpeg dragged in with no type", file("photo.JPG", ""), true],
    ["a png handed over as bytes", file("shot.png", "application/octet-stream"), true],
    ["an svg", file("logo.svg", "image/svg+xml"), false],
    ["a heic", file("IMG_1.heic", "image/heic"), false],
    ["a pdf", file("q3.pdf", "application/pdf"), false],
    ["a typeless file", file("Makefile", ""), false],
  ])("%s", (_, f, picture) => {
    expect(isImage(f)).toBe(picture)
  })

  test("a file without a type is stored as bytes, a known picture as its type", () => {
    expect(attachmentType(file("notes", ""))).toBe("application/octet-stream")
    expect(attachmentType(file("a.webp", ""))).toBe("image/webp")
    expect(attachmentType(file("a.txt", "text/plain; charset=utf-8"))).toBe("text/plain")
  })

  test("a message's pictures come first and the rest keep their order", () => {
    const files = [file("a.pdf", "application/pdf"), file("b.png", "image/png"), file("c.zip", "application/zip"), file("d.gif", "image/gif")]
    const { images, others } = splitFiles(files)
    expect(images.map((f) => f.name)).toEqual(["b.png", "d.gif"])
    expect(others.map((f) => f.name)).toEqual(["a.pdf", "c.zip"])
  })
})

describe("the composer's limits", () => {
  test("a picture may be 10 MB and a file 50 MB", () => {
    const { accepted, refusals } = admit(0, [
      file("ok.png", "image/png", 10 * MB),
      file("big.png", "image/png", 10 * MB + 1),
      file("ok.zip", "application/zip", 50 * MB),
      file("big.zip", "application/zip", 50 * MB + 1),
    ])
    expect(accepted.map((f) => f.name)).toEqual(["ok.png", "ok.zip"])
    expect(refusals).toEqual(["big.png is over 10 MB", "big.zip is over 50 MB"])
  })

  test("no more than 10 files, counting the ones already in the box, refused once", () => {
    const many = Array.from({ length: 5 }, (_, i) => file(`${i}.png`, "image/png"))
    const { accepted, refusals } = admit(MAX_FILES - 2, many)
    expect(accepted.map((f) => f.name)).toEqual(["0.png", "1.png"])
    expect(refusals).toEqual(["You can attach up to 10 files. 3 files were left out"])
  })

  test("a full box takes nothing", () => {
    expect(admit(MAX_FILES, [file("a.png", "image/png")])).toEqual({ accepted: [], refusals: ["You can attach up to 10 files. 1 file was left out"] })
  })
})

describe("the picture grid and the dialog", () => {
  test("a lone picture spans both columns, two or more take one each", () => {
    expect(tileSpan(1)).toBe(2)
    expect(tileSpan(2)).toBe(1)
    expect(tileSpan(5)).toBe(1)
  })

  test("the arrows wrap both ways", () => {
    expect(wrapIndex(3, 3)).toBe(0)
    expect(wrapIndex(-1, 3)).toBe(2)
    expect(wrapIndex(-7, 3)).toBe(2)
    expect(wrapIndex(1, 0)).toBe(0)
  })
})
