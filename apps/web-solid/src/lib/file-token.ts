import { createSignal } from "solid-js"
import { apiFetch } from "./api"
import { apiUrl, read, write } from "./api-base"

const KEY = "kiko:file-token"
const [fileToken, setSignal] = createSignal(read(KEY))

const REFRESH_BEFORE_MS = 10 * 60 * 1000
let timer: ReturnType<typeof setTimeout> | undefined

export const expiresAt = (token: string): number => Number(token.split(".")[2]) * 1000

export function setFileToken(next: string): void {
  write(KEY, next)
  setSignal(next)
  clearTimeout(timer)
  timer = setTimeout(() => void refreshFileToken(), Math.max(0, expiresAt(next) - REFRESH_BEFORE_MS - Date.now()))
}

export async function refreshFileToken(): Promise<void> {
  const res = await apiFetch("/api/files/token").catch(() => null)
  if (res?.ok) setFileToken(((await res.json()) as { fileToken: string }).fileToken)
  else timer = setTimeout(() => void refreshFileToken(), 60_000)
}

export function clearFileToken(): void {
  clearTimeout(timer)
  write(KEY, null)
  setSignal(null)
}

export function fileUrl(path: string): string {
  const t = fileToken()
  return apiUrl(path) + (t ? `?t=${t}` : "")
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const t = fileToken()
    if (document.visibilityState === "visible" && t && expiresAt(t) - Date.now() < REFRESH_BEFORE_MS)
      void refreshFileToken()
  })
}

export { fileToken }
