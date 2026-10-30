import { ARCHIVE_MAX_BYTES, type ArchiveRequest, type ArchiveResult } from "./archive"
import { readZipDirectory } from "./zip-directory"

const post = (value: ArchiveResult) =>
  (self as unknown as { postMessage: (value: unknown, transfer: Transferable[]) => void }).postMessage(value, [])

async function open(input: ArchiveRequest) {
  const response = await fetch(input.src, { cache: "no-store" })
  if (!response.ok) throw new Error("This archive could not be loaded.")
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > ARCHIVE_MAX_BYTES) throw new Error("Preview limited to archives under 25 MB.")
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  post({ type: "entries", entries: readZipDirectory(buffer), size: bytes.byteLength })
}

self.addEventListener("message", (event: MessageEvent<ArchiveRequest>) => {
  void open(event.data).catch((cause: unknown) =>
    post({ type: "error", message: cause instanceof Error ? cause.message : "Could not read this archive." }),
  )
})
