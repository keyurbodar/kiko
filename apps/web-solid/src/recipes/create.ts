import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { history, openChat } from "../app/history"
import { fillComposer } from "../composer/fill"
import { putFile, rememberMade } from "../files/api"
import { HOME } from "../files/model"
import { user } from "../state/user"
import { freeSlug, recipeTemplate } from "./model"
import { cards } from "./state"

export function createWithKiko(): void {
  const roomId = user.kikoChatId()
  if (!roomId) return void showToastV2({ title: "Could not open Kiko", variant: "error" })
  fillComposer(roomId, "Make me a recipe that ")
  openChat(roomId)
}

export async function startBlankRecipe(): Promise<void> {
  const taken = new Set([...cards().map((c) => c.slug), ...user.homeFiles().map((f) => f.name.split("/")[1] ?? "")])
  const slug = freeSlug(taken)
  const path = `recipes/${slug}/RECIPE.md`
  const saved = await putFile(HOME, path, recipeTemplate(slug), "text/markdown", "none")
  if (saved.kind !== "saved")
    return void showToastV2({
      title: "Could not create the recipe",
      description: saved.kind === "error" ? saved.message : undefined,
      variant: "error",
    })
  rememberMade(HOME, saved.file)
  history.push(`/files?open=${encodeURIComponent(`${HOME}/${path}`)}`)
}
