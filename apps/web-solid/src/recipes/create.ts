import type { FileRef } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { openChat } from "../app/history"
import { openFile } from "../chat/side/surfaces"
import { fillComposer } from "../composer/fill"
import { apiFetch } from "../lib/api"
import { rememberMade } from "../files/api"
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

async function writeHome(path: string, text: string): Promise<FileRef | string> {
  const res = await apiFetch(`/api/files/${HOME}?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "content-type": "text/markdown", "x-kiko-if-sha256": "none" },
    body: text,
  }).catch(() => null)
  if (!res) return "Could not reach the server"
  const body = (await res.json().catch(() => ({}))) as { file?: FileRef; error?: string }
  return res.ok && body.file ? body.file : (body.error ?? `The server said ${res.status}`)
}

export async function startBlankRecipe(): Promise<void> {
  const roomId = user.kikoChatId()
  const taken = new Set([...cards().map((c) => c.slug), ...user.homeFiles().map((f) => f.name.split("/")[1] ?? "")])
  const slug = freeSlug(taken)
  const path = `recipes/${slug}/RECIPE.md`
  const saved = await writeHome(path, recipeTemplate(slug))
  if (typeof saved === "string" || !roomId)
    return void showToastV2({
      title: "Could not create the recipe",
      description: typeof saved === "string" ? saved : undefined,
      variant: "error",
    })
  rememberMade(HOME, saved)
  openFile(roomId, `${HOME}/${path}`)
  openChat(roomId)
}
