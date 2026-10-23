import {
  NotFoundError,
  type InstallRecipe,
  type RecipeCard,
  type RecipeInstall,
  type RecipeNeedsConnect,
} from "@kiko/protocol"
import * as Cause from "effect/Cause"
import { RECIPES } from "./catalog.gen"
import { failureMessage, load, owner, run } from "../state/runtime"

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
  const list = await load(owner.queries.recipes(undefined), { refresh: true }).catch(() => null)
  if (!list) return null
  const next: Listing = { cards: list.cards, installs: list.installs, broken: list.broken }
  cacheListing(next)
  return next
}

export function cacheListing(next: Listing): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next))
  } catch {}
}

export async function deleteInstall(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await run(owner.commands.recipesUninstall, { installId: id })
  if (result._tag === "Success" || Cause.squash(result.cause) instanceof NotFoundError) return { ok: true }
  return { ok: false, error: "Kiko could not remove it. Try again." }
}

export async function updateRecipeRoutine(id: string, status: "active" | "paused"): Promise<boolean> {
  return (await run(owner.commands.routinesUpdate, { id, status }))._tag === "Success"
}

export async function postInstall(body: InstallRecipe): Promise<InstallResult> {
  const result = await run(owner.commands.recipesInstall, body)
  if (result._tag === "Failure") return { ok: false, error: failureMessage(result.cause, "Could not add that recipe.") }
  if ("install" in result.value) return { ok: true, install: result.value.install }
  return { ok: false, connect: result.value }
}

export async function postEdit(slug: string): Promise<string | null> {
  const result = await run(owner.commands.recipesEdit, { slug })
  return result._tag === "Success" ? result.value.path : null
}
