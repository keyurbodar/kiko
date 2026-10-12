import { KernelError } from "./client"

/** Largest file the browser moves in either direction. */
export const FILE_CAP = 10 * 1024 * 1024
/** Longest URL a fetch accepts. */
export const URL_CAP = 2048
/** Methods a fetch may use. OPTIONS and anything else are refused at the edge. */
export const FETCH_METHODS: Record<string, true> = { GET: true, HEAD: true, POST: true, PUT: true, PATCH: true, DELETE: true }

export function basenameOf(path: string): string {
  const name = path.split(/[\\/]/).pop()?.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").slice(0, 200) ?? ""
  if (!name) throw new KernelError("failed", "bad file name")
  return name
}

export function decodeBase64(base64: string): Uint8Array {
  if (base64.length > Math.ceil(FILE_CAP / 3) * 4) throw new KernelError("failed", "file is over 10 MB")
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  if (bytes.byteLength > FILE_CAP) throw new KernelError("failed", "file is over 10 MB")
  return bytes
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
