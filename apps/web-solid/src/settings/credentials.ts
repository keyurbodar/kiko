import { apiFetch } from "../lib/api"

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

export async function checkProvider(provider: string): Promise<ProviderInfo> {
  return (await request<{ provider: ProviderInfo }>(`/${encodeURIComponent(provider)}/check`, { method: "POST" })).provider
}
