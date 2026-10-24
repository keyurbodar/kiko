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

let current: { readonly url: string; readonly token: string } | null = null

export function useBackend(next: { readonly url: string; readonly token: string } | null): void {
  current = next
}

export const base = () => (current?.url ?? import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "")

export const apiUrl = (path: string): string => (path.startsWith("/") ? base() + path : path)

export const getToken = () => current?.token ?? null
