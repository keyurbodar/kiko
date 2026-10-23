import { apiUrl, base, getToken, setToken } from "./api-base"

export { apiUrl, getToken, setToken }
const SOCKET_PROTOCOL = "kiko"

let onUnauthorized = () => {}
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set("authorization", `Bearer ${token}`)
  const url = apiUrl(path)
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401 && token && token === getToken() && url === apiUrl(path)) {
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
