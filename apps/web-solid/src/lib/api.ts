import { apiUrl, getToken, setToken } from "./api-base"

export { apiUrl, getToken, setToken }

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
