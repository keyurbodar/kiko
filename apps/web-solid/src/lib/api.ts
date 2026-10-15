/*
 * The one place that knows where the backend is and how to prove who you are. The base is "" (this origin)
 * unless `kiko:backend` is stored or VITE_API_BASE is set. A request carries the bearer token. A file URL
 * and a socket cannot carry a header, so a file URL takes a read-only `?t=` token and a socket offers
 * the bearer as a subprotocol.
 */

import { apiUrl, base, getToken, setToken } from "./api-base"

export { apiUrl, getToken, setToken }
export const SOCKET_PROTOCOL = "kiko"

let onUnauthorized = () => {}
/** The session calls this once, to be told when the server stops accepting the token. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

/** `fetch` for every call to the backend. A 401 drops the token and signs the person out. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set("authorization", `Bearer ${token}`)
  const res = await fetch(apiUrl(path), { ...init, headers })
  if (res.status === 401 && token) {
    setToken(null)
    onUnauthorized()
  }
  return res
}

export function socketUrl(path: string): string {
  const root = base() || globalThis.location?.origin || "http://localhost"
  return root.replace(/^http/, "ws") + path
}

export function socketProtocols(): string[] {
  const token = getToken()
  return token ? [SOCKET_PROTOCOL, token] : [SOCKET_PROTOCOL]
}
