import { describe, expect, test } from "bun:test"
import { admit, attachmentType, isImage, MAX_ATTACHMENTS, sendRefusal, splitFiles, tileSpan, wrapIndex } from "./attachments"

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

describe("the composer's limits, as t3code's", () => {
  test("a picture of any size is taken to be shrunk, a file may be 50 MB", () => {
    const out = admit(0, [file("huge.png", "image/png", 30 * MB), file("ok.zip", "application/zip", 50 * MB), file("big.zip", "application/zip", 50 * MB + 1)])
    expect(out.images.map((f) => f.name)).toEqual(["huge.png"])
    expect(out.files.map((f) => f.name)).toEqual(["ok.zip"])
    expect(out.error).toBe("'big.zip' exceeds the 50 MB attachment limit.")
  })

  test("a picture yuki cannot send is refused, not turned into a file", () => {
    const out = admit(0, [file("logo.svg", "image/svg+xml"), file("IMG_1.heic", "image/heic")])
    expect(out.images).toEqual([])
    expect(out.files).toEqual([])
    expect(out.error).toBe("'IMG_1.heic' is not a supported image type. Attach GIF, JPEG, PNG, or WebP images.")
  })

  test("an empty file is refused", () => {
    expect(admit(0, [file("blank.txt", "text/plain", 0)]).error).toBe("'blank.txt' is empty or could not be read.")
  })

  test("no more than 100 files, counting the ones already in the box", () => {
    const many = Array.from({ length: 5 }, (_, i) => file(`${i}.pdf`, "application/pdf"))
    const out = admit(MAX_ATTACHMENTS - 2, many)
    expect(out.files.map((f) => f.name)).toEqual(["0.pdf", "1.pdf"])
    expect(out.error).toBe("You can attach up to 100 files per message.")
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

describe("a draft too long to send stays in the box", () => {
  test("a long message is sent whole, since one frame holds it", () => {
    expect(sendRefusal("x".repeat(40_000), false)).toBeNull()
  })

  test("a draft over the frame is refused with the reason, so the composer leaves it in the box", () => {
    // A control character takes six characters of JSON, so 100,000 of them overflow the frame.
    expect(sendRefusal("\u0001".repeat(100_000), false)).toBe("This message is too long to send.")
  })

  test("the file names in a send count toward the frame, not only the text", () => {
    // A 500,000-character text fits the frame alone; 100 names of 255 characters push it over.
    const names = Array.from({ length: 100 }, (_, i) => ({ pendingId: `p${i}`, name: "n".repeat(255), type: "application/pdf", size: 1 }))
    expect(sendRefusal("x".repeat(500_000), false)).toBeNull()
    expect(sendRefusal("x".repeat(500_000), false, names)).toBe("This message is too long to send.")
  })

  test("an edit is held to the bubble limit, since it cannot carry a file", () => {
    expect(sendRefusal("x".repeat(16_000), true)).toBeNull()
    expect(sendRefusal("x".repeat(16_001), true)).toBe("Edits can be up to 16,000 characters.")
  })
})
