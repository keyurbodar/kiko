import { apiFetch } from "../lib/api"
// The HTTP client for provider credentials. A key goes up in one PUT and never
// comes back: every answer holds the provider, the kind, and the last four
// characters. The key is never kept on the client: not in a store that outlives
// the dialog, not in IndexedDB, not in a URL.

export interface ProviderInfo {
  provider: string
  kind: string
  last4: string
  /** The provider turned this key down; the row says so. */
  refused?: boolean
  /** From pi-ai's catalog, so a list without the catalog can tell a chat provider from a judge. */
  chat?: boolean
  judge?: boolean
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/api/credentials${path}`, init)
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown }
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Request failed.")
  return body
}

export async function listProviders(): Promise<ProviderInfo[]> {
  return (await request<{ providers: ProviderInfo[] }>("")).providers
}

export async function connectProvider(provider: string, apiKey: string): Promise<ProviderInfo> {
  const body = await request<{ provider: ProviderInfo }>(`/${encodeURIComponent(provider)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  })
  return body.provider
}

export async function disconnectProvider(provider: string): Promise<void> {
  await request(`/${encodeURIComponent(provider)}`, { method: "DELETE" })
}
