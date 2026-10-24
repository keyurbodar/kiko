import { NotFoundError, type InstallRecipe, type RecipeInstall, type RecipeNeedsConnect } from "@kiko/protocol"
import * as Cause from "effect/Cause"
import { failureMessage, owner, run } from "../state/runtime"

export type InstallResult =
  | { ok: true; install: RecipeInstall }
  | { ok: false; error: string }
  | { ok: false; connect: RecipeNeedsConnect }

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
