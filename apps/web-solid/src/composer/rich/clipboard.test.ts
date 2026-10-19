import { expect, test } from "bun:test"
import { copyComposerFragment, pastedComposerFragment, rememberClipboardFile } from "./clipboard"

test("copy retains file bytes after the source draft releases its URL", async () => {
  const file = new File(["actual bytes"], "notes.txt", { type: "text/plain" })
  const url = URL.createObjectURL(file)
  const attachment = { type: "image", id: "source-id", filename: file.name, mime: file.type, size: file.size, blob: { id: "blob-id", url } } as const
  rememberClipboardFile(attachment, file)
  const data = new Map<string, string>()
  const transfer = { setData: (type: string, value: string) => { data.set(type, value) }, getData: (type: string) => data.get(type) ?? "" }
  copyComposerFragment("See [notes.txt](attachment:source-id)", transfer)
  URL.revokeObjectURL(url)
  const fragment = pastedComposerFragment(transfer)
  expect(fragment?.markdown).toBe("See [notes.txt](attachment:source-id)")
  expect(await fragment?.files[0]?.file.text()).toBe("actual bytes")
  expect(fragment?.files[0]?.file.name).toBe("notes.txt")
  data.delete("application/x-kiko-composer")
  expect(pastedComposerFragment(transfer)?.files).toHaveLength(1)
})

test("portable clipboard restores binary files without source page state", async () => {
  const payload = JSON.stringify({
    version: 1,
    markdown: "[file](attachment:portable-id)",
    files: [{ id: "portable-id", filename: "binary.dat", mime: "application/octet-stream", dataUrl: "data:application/octet-stream;base64,AAH/" }],
  })
  const custom = pastedComposerFragment({ getData: (type) => type === "application/x-kiko-composer" ? payload : "" })
  expect(custom?.markdown).toBe("[file](attachment:portable-id)")
  expect(custom?.files[0]?.file.name).toBe("binary.dat")
  expect([...new Uint8Array(await custom!.files[0]!.file.arrayBuffer())]).toEqual([0, 1, 255])
  const html = `<div data-kiko-payload="${encodeURIComponent(payload)}"></div>`
  const fallback = pastedComposerFragment({ getData: (type) => type === "text/html" ? html : "" })
  expect([...new Uint8Array(await fallback!.files[0]!.file.arrayBuffer())]).toEqual([0, 1, 255])
  expect(fallback?.files[0]?.attachment.mime).toBe("application/octet-stream")
})

test("invalid portable clipboard data is ignored", () => {
  for (const files of [[{ id: 12 }], [{ id: "id", filename: "file", mime: "text/plain", dataUrl: "https://example.com/file" }]]) {
    const payload = JSON.stringify({ version: 1, markdown: "text", files })
    expect(pastedComposerFragment({ getData: (type) => type === "application/x-kiko-composer" ? payload : "" })).toBeUndefined()
  }
})

test("rapid copy waits for retained bytes and preserves the blob hash across pages", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  const originalItem = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem")
  let written: Promise<Blob> | undefined
  class Item {
    constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
  }
  Object.defineProperty(globalThis, "ClipboardItem", { configurable: true, value: Item })
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { write: (items: Item[]) => {
    written = Promise.resolve(items[0]!.data["text/html"]!)
    return Promise.resolve()
  } } } })
  try {
    const file = new File(["rapid bytes"], "rapid.txt", { type: "text/plain" })
    rememberClipboardFile({ type: "image", id: "rapid-id", filename: file.name, mime: file.type, size: file.size, blob: { id: "content-hash", url: "blob:released" } }, file)
    const data = new Map<string, string>()
    copyComposerFragment("[rapid.txt](attachment:rapid-id)", { setData: (type, value) => { data.set(type, value) } })
    expect(data.get("text/html")).not.toContain("data-kiko-payload")
    expect(written).toBeDefined()
    const html = (await (await written!)!.text()).replace(/ data-kiko-clipboard="[^"]*"/, "")
    const fragment = pastedComposerFragment({ getData: (type) => type === "text/html" ? html : "" })
    expect(await fragment?.files[0]?.file.text()).toBe("rapid bytes")
    expect(fragment?.files[0]?.attachment.blob.id).toBe("content-hash")
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator)
    else Reflect.deleteProperty(globalThis, "navigator")
    if (originalItem) Object.defineProperty(globalThis, "ClipboardItem", originalItem)
    else Reflect.deleteProperty(globalThis, "ClipboardItem")
  }
})
