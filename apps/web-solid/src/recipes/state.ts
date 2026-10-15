import { KIKO, type RecipeCard, type RecipeInstall } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal } from "solid-js"
import { openFile } from "../chat/side/surfaces"
import { useApp } from "../lib/store"
import { cardsOf, fetchListing, loadListing, type Listing, postInstall } from "./api"
import { installedSlugs } from "./model"

/*
 * The recipes the user has added, and the requests in flight. An add marks its card Added and
 * takes the user to the chat before the server answers. A refused add takes the mark back and says why.
 */

const [listing, setListing] = createSignal<Listing>(loadListing())
const [adding, setAdding] = createSignal<ReadonlySet<string>>(new Set())
const [owning, setOwning] = createSignal<ReadonlySet<string>>(new Set())
let pending: Promise<void> | undefined

/** The cards the gallery and the starter show. */
export const cards = (): readonly RecipeCard[] => cardsOf(listing())

/** Gets the list from the server. Calls while one is in flight share it. */
export const refreshListing = (): Promise<void> =>
  (pending ??= fetchListing()
    .then((next) => {
      if (next) setListing(next)
    })
    .finally(() => {
      pending = undefined
    }))

/** Why each recipe file that did not load was refused, so the page can say what to fix. */
export const broken = (): readonly string[] => listing().broken ?? []

/** Opens a recipe's file in the Kiko chat's files, where the human reads or edits it. */
export function openRecipeFile(slug: string, navigate: (to: string) => void): void {
  const roomId = useApp.kikoChatId()
  if (!roomId) return
  openFile(roomId, `home/recipes/${slug}/RECIPE.md`)
  navigate(`/chat/${roomId}`)
}

export const isAdded = (slug: string): boolean => adding().has(slug) || installedSlugs(listing().installs).has(slug)

export const isOwning = (slug: string): boolean => owning().has(slug)

const mark = (set: (update: (s: ReadonlySet<string>) => ReadonlySet<string>) => void, slug: string, on: boolean) =>
  set((s) => {
    const next = new Set(s)
    if (on) next.add(slug)
    else next.delete(slug)
    return next
  })

const recorded = (install: RecipeInstall) => setListing((l) => ({ ...l, installs: [...l.installs, install] }))

const failed = (card: RecipeCard, error: string) => showToastV2({ title: `Could not add ${card.title}`, description: error, variant: "error" })

/** Adds the recipe to Kiko's chat. The chat opens at once; the server's answer only undoes the mark. */
export function addToKiko(card: RecipeCard, navigate: (to: string) => void): void {
  const roomId = useApp.kikoChatId()
  if (!roomId) return
  mark(setAdding, card.slug, true)
  navigate(`/chat/${roomId}`)
  void postInstall({ installId: crypto.randomUUID(), slug: card.slug, roomId, agent: KIKO }).then((result) => {
    mark(setAdding, card.slug, false)
    if (result.ok) recorded(result.install)
    else failed(card, result.error)
  })
}

/** Gives the recipe its own new chat, then opens it. Nothing opens until the server has made the chat. */
export function addOwnChat(card: RecipeCard, navigate: (to: string) => void): void {
  mark(setOwning, card.slug, true)
  void postInstall({ installId: crypto.randomUUID(), slug: card.slug, own: true }).then((result) => {
    mark(setOwning, card.slug, false)
    if (!result.ok) return failed(card, result.error)
    recorded(result.install)
    navigate(`/chat/${result.install.roomId}`)
  })
}
