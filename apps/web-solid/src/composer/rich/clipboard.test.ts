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
