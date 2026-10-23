import type { InstallRecipe, RecipeCard, RecipeInstall, RecipeNeedsConnect } from "@kiko/protocol"
import { RECIPES } from "./catalog.gen"
import { apiFetch } from "../lib/api"

export type InstallResult =
  | { ok: true; install: RecipeInstall }
  | { ok: false; error: string }
  | { ok: false; connect: RecipeNeedsConnect }

export type Listing = { cards?: readonly RecipeCard[]; installs: readonly RecipeInstall[]; broken?: readonly string[] }

const CACHE_KEY = "kiko:recipes:v2"

export function loadListing(): Listing {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Listing | null
    if (cached && Array.isArray(cached.installs)) return cached
  } catch {}
  return { installs: [] }
}

export const cardsOf = (list: Listing): readonly RecipeCard[] => list.cards ?? RECIPES

export const loadCards = (): readonly RecipeCard[] => cardsOf(loadListing())

export async function fetchListing(): Promise<Listing | null> {
  const res = await apiFetch("/api/recipes").catch(() => null)
  if (!res?.ok) return null
  const body = (await res.json().catch(() => null)) as { cards?: unknown; installs?: unknown; broken?: unknown } | null
  const next: Listing = {
    cards: Array.isArray(body?.cards) ? (body.cards as RecipeCard[]) : undefined,
    installs: Array.isArray(body?.installs) ? (body.installs as RecipeInstall[]) : [],
    broken: Array.isArray(body?.broken) ? (body.broken as string[]) : [],
  }
  cacheListing(next)
  return next
}

export function cacheListing(next: Listing): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next))
  } catch {}
}

export async function deleteInstall(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await apiFetch(`/api/recipes/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null)
  if (res?.ok || res?.status === 404) return { ok: true }
  return { ok: false, error: "Kiko could not remove it. Try again." }
}

export async function updateRecipeRoutine(id: string, status: "active" | "paused"): Promise<boolean> {
  const res = await apiFetch(`/api/routines/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  }).catch(() => null)
  return res?.ok ?? false
}

export async function postInstall(body: InstallRecipe): Promise<InstallResult> {
  const res = await apiFetch("/api/recipes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null)
  if (!res) return { ok: false, error: "Kiko did not answer." }
  const data = (await res.json().catch(() => null)) as
    | (Partial<RecipeNeedsConnect> & { install?: RecipeInstall; error?: string })
    | null
  if (res.ok && data?.state === "needs_connect")
    return {
      ok: false,
      connect: { state: "needs_connect", links: data.links ?? [], ...(data.reason ? { reason: data.reason } : {}) },
    }
  if (res.ok && data?.install) return { ok: true, install: data.install }
  return { ok: false, error: data?.error ?? "Could not add that recipe." }
}

export async function postEdit(slug: string): Promise<string | null> {
  const res = await apiFetch(`/api/recipes/${encodeURIComponent(slug)}/edit`, { method: "POST" }).catch(() => null)
  const data = res?.ok ? ((await res.json().catch(() => null)) as { path?: unknown } | null) : null
  return typeof data?.path === "string" ? data.path : null
}
