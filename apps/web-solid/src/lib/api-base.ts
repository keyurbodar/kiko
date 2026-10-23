const TOKEN_KEY = "kiko:token"
const BACKEND_KEY = "kiko:backend"

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
  } catch {}
}

export const base = () => (read(BACKEND_KEY) ?? import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "")

export const apiUrl = (path: string): string => (path.startsWith("/") ? base() + path : path)

let token = read(TOKEN_KEY)
export const getToken = () => token
export function setToken(next: string | null): void {
  token = next
  write(TOKEN_KEY, next)
}
