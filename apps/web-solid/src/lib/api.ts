/*
 * The one place that knows where the backend is and how to prove who you are. The base is "" (this origin)
 * unless `kiko:backend` is stored or VITE_API_BASE is set. A request carries the bearer token. A file URL
 * and a socket cannot carry a header, so a file URL takes a read-only `?t=` token and a socket offers
 * the bearer as a subprotocol.
 */

const TOKEN_KEY = "kiko:token"
const BACKEND_KEY = "kiko:backend"
export const SOCKET_PROTOCOL = "kiko"

export function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // storage can be blocked. the token still works for this page load.
  }
}

const base = () => (read(BACKEND_KEY) ?? import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "")

export const apiUrl = (path: string): string => (path.startsWith("/") ? base() + path : path)

let token = read(TOKEN_KEY)
export const getToken = () => token
export function setToken(next: string | null): void {
  token = next
  write(TOKEN_KEY, next)
}

let onUnauthorized = () => {}
/** The session calls this once, to be told when the server stops accepting the token. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

/** `fetch` for every call to the backend. A 401 drops the token and signs the person out. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
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

export const socketProtocols = (): string[] => (token ? [SOCKET_PROTOCOL, token] : [SOCKET_PROTOCOL])
