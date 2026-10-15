import { createSignal } from "solid-js"
import { apiUrl, read, write } from "./api-base"

// The read-only token the backend sends in its hello reply. A file URL carries it as `?t=`, because an image
// or a link cannot send a header. It is kept so a warm paint before the first hello still has a URL that loads.
const KEY = "kiko:file-token"
const [fileToken, setSignal] = createSignal(read(KEY))

export function setFileToken(next: string): void {
  write(KEY, next)
  setSignal(next)
}

export function clearFileToken(): void {
  write(KEY, null)
  setSignal(null)
}

/** A download URL that works in `<img>`, `<a>`, and viewers. Reactive, so a new token reaches a URL read in an effect. */
export function fileUrl(path: string): string {
  const t = fileToken()
  return apiUrl(path) + (t ? `?t=${t}` : "")
}

export { fileToken }
