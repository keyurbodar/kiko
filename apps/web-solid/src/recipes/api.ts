import type { InstallRecipe, RecipeInstall, RecipeList } from "@kiko/protocol"

export type InstallResult = { ok: true; install: RecipeInstall } | { ok: false; error: string }

/** The recipes the user has added. A failed request reads as none added, so the gallery still opens. */
export async function listInstalls(): Promise<readonly RecipeInstall[]> {
  const res = await fetch("/api/recipes").catch(() => null)
  if (!res?.ok) return []
  const body = (await res.json().catch(() => null)) as RecipeList | null
  return Array.isArray(body?.installs) ? body.installs : []
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
