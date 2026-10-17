import { apiFetch } from "../lib/api"
// The HTTP client for provider credentials. A key goes up in one PUT and never
// comes back: every answer holds the provider, the kind, and the last four
// characters. The key is never kept on the client: not in a store that outlives
// the dialog, not in IndexedDB, not in a URL.

import type { ProviderInfo } from "@kiko/protocol"

export type { ProviderInfo }

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

/** "Check again": the server refreshes the sign-in, sends its cheapest request, and answers with the provider's row. */
export async function checkProvider(provider: string): Promise<ProviderInfo> {
  return (await request<{ provider: ProviderInfo }>(`/${encodeURIComponent(provider)}/check`, { method: "POST" })).provider
}
