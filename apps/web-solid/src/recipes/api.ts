import type { InstallRecipe, RecipeCard, RecipeInstall } from "@kiko/protocol"
import { RECIPES } from "./catalog.gen"

export type InstallResult = { ok: true; install: RecipeInstall } | { ok: false; error: string }

/**
 * The last list the server sent. `cards` is there only when the server sent it, so a build's
 * catalog is never cached and a new build's cards win at once.
 */
export type Listing = { cards?: readonly RecipeCard[]; installs: readonly RecipeInstall[]; broken?: readonly string[] }

const CACHE_KEY = "kiko:recipes"

/** The list this device saw last, so the page paints with the user's installs at once. */
export function loadListing(): Listing {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Listing | null
    if (cached && Array.isArray(cached.installs)) return cached
  } catch {
    // A corrupt cache reads as none.
  }
  return { installs: [] }
}

/** The server's cards when it has sent some, else the build's catalog. */
export const cardsOf = (list: Listing): readonly RecipeCard[] => list.cards ?? RECIPES

/** The cards to show before any request: the cached list's, else the build's catalog. Synchronous, so the page paints at once. */
export const loadCards = (): readonly RecipeCard[] => cardsOf(loadListing())

/** The list from the server, cached for the next visit. Null when the request fails, so the cache stays as it was. */
export async function fetchListing(): Promise<Listing | null> {
  const res = await fetch("/api/recipes").catch(() => null)
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
  } catch {
    // Storage full or off: the page still works, it just does not paint from cache next time.
  }
}

export async function deleteInstall(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`/api/recipes/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null)
  if (res?.ok || res?.status === 404) return { ok: true }
  return { ok: false, error: "Kiko could not remove it. Try again." }
}

export async function updateRecipeRoutine(id: string, status: "active" | "paused"): Promise<boolean> {
  const res = await fetch(`/api/routines/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => null)
  return res?.ok ?? false
}

/** Adds a recipe. A retry with the same `installId` is safe: the server answers with the same install. */
export async function postInstall(body: InstallRecipe): Promise<InstallResult> {
  const res = await fetch("/api/recipes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null)
  if (!res) return { ok: false, error: "Kiko did not answer." }
  const data = (await res.json().catch(() => null)) as { install?: RecipeInstall; error?: string } | null
  if (res.ok && data?.install) return { ok: true, install: data.install }
  return { ok: false, error: data?.error ?? "Could not add that recipe." }
}
