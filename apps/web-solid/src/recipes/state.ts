import { KIKO, type RecipeCard, type RecipeInstall, type RecipeRoutine, type RoomId } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal } from "solid-js"
import { openFile } from "../chat/side/surfaces"
import { useApp } from "../lib/store"
import { installedSlugs } from "./model"
import { cardsOf, fetchListing, loadListing, type Listing, postEdit, postInstall, deleteInstall, cacheListing, updateRecipeRoutine } from "./api"

/*
 * The recipes the user has added, and the requests in flight. An add shows its agent chip and
 * takes the user to the chat before the server answers. A refused add takes the mark back and says why.
 */

const [listing, setListing] = createSignal<Listing>(loadListing())
const [owning, setOwning] = createSignal<ReadonlySet<string>>(new Set())
let pending: Promise<void> | undefined
let revision = 0
let mutations = 0

/** The cards the page and the starter show. */
export const cards = (): readonly RecipeCard[] => cardsOf(listing())

/** Gets the list from the server. Calls while one is in flight share it. */
export const refreshListing = (): Promise<void> => {
  const started = revision
  return (pending ??= fetchListing()
    .then((next) => {
      if (next && started === revision && mutations === 0) setListing(next)
      else cacheListing(listing())
    })
    .finally(() => {
      pending = undefined
    }))
}

/** Why each recipe file that did not load was refused, so the page can say what to fix. */
export const broken = (): readonly string[] => listing().broken ?? []

/** Opens a recipe's file in the Kiko chat's files. A built-in is written to the drive first, so there is a file to edit. */
export async function editRecipe(slug: string, navigate: (to: string) => void): Promise<void> {
  const roomId = useApp.kikoChatId()
  const path = await postEdit(slug)
  if (!roomId || !path) return void showToastV2({ title: "Could not open the recipe", variant: "error" })
  openFile(roomId, `home/${path}`)
  navigate(`/chat/${roomId}`)
}

export type RecipeTarget = { roomId: RoomId; agent: string; name: string }

export function targetsForChat(roomId: string): RecipeTarget[] {
  if (useApp.room()?.state.roomId === roomId && useApp.roomMembers().length) return useApp.roomMembers().map((m) => ({ roomId: roomId as RoomId, agent: m.slug, name: m.name }))
  const chat = useApp.user()?.chats().find((c) => c.roomId === roomId)
  if (!chat) return []
  const agents = useApp.agents()
  const slugs = (chat.agents?.length ? chat.agents : [KIKO]).map((id) => agents.find((a) => a.id === id)?.slug ?? id)
  if (slugs.length > 1 && !slugs.includes(KIKO)) slugs.unshift(KIKO)
  return [...new Set(slugs)].map((agent) => ({ roomId: roomId as RoomId, agent, name: agentName(agent) }))
}

export const installs = (): readonly RecipeInstall[] => listing().installs
export const installsFor = (slug: string): readonly RecipeInstall[] => listing().installs.filter((i) => i.slug === slug)
export const agentName = (slug: string): string => slug === KIKO ? "Kiko" : useApp.agents().find((a) => a.slug === slug)?.name ?? slug
export const isAdded = (slug: string, target?: RecipeTarget): boolean => !!target && installedSlugs(listing().installs, target).has(slug)

/** Pauses or resumes every routine of one install. It shows at once and goes back if the server refuses. */
export function setInstallPaused(install: RecipeInstall, paused: boolean): void {
  const status = paused ? "paused" : "active"
  const before = new Map(install.routines.map((r) => [r.id, r.status]))
  const put = (pick: (r: RecipeRoutine) => RecipeRoutine["status"]) =>
    changeInstalls((all) => all.map((i) => (i.installId === install.installId ? { ...i, routines: i.routines.map((r) => ({ ...r, status: pick(r) })) } : i)))
  mutations++
  put(() => status)
  void Promise.all(install.routines.map((r) => updateRecipeRoutine(r.id, status))).then((done) => {
    mutations--
    if (done.every(Boolean)) return
    put((r) => before.get(r.id) ?? r.status)
    showToastV2({ title: paused ? "Could not pause it" : "Could not resume it", variant: "error" })
  })
}

function changeInstalls(update: (installs: readonly RecipeInstall[]) => readonly RecipeInstall[]): void {
  revision++
  setListing((l) => {
    const next = { ...l, installs: update(l.installs) }
    cacheListing(next)
    return next
  })
}

export function removeInstall(install: RecipeInstall): void {
  mutations++
  changeInstalls((list) => list.filter((i) => i.installId !== install.installId))
  void deleteInstall(install.installId).then((result) => {
    mutations--
    if (result.ok) return
    changeInstalls((list) => [...list, install])
    showToastV2({ title: "Could not remove recipe", description: result.error, variant: "error" })
  })
}

export const isOwning = (slug: string): boolean => owning().has(slug)

const mark = (set: (update: (s: ReadonlySet<string>) => ReadonlySet<string>) => void, slug: string, on: boolean) =>
  set((s) => {
    const next = new Set(s)
    if (on) next.add(slug)
    else next.delete(slug)
    return next
  })

const recorded = (install: RecipeInstall) => changeInstalls((list) => [...list.filter((i) => i.installId !== install.installId), install])

const failed = (card: RecipeCard, error: string) => showToastV2({ title: `Could not add ${card.title}`, description: error, variant: "error" })

/** Adds to one agent in one chat. The chat opens before the server answers. */
export function addToTarget(card: RecipeCard, target: RecipeTarget | undefined, navigate: (to: string) => void): void {
  if (!target || isAdded(card.slug, target)) return
  const install: RecipeInstall = { installId: crypto.randomUUID(), slug: card.slug, roomId: target.roomId, agent: target.agent, at: Date.now(), routines: [] }
  mutations++
  recorded(install)
  navigate(`/chat/${target.roomId}`)
  void postInstall({ ...install }).then((result) => {
    mutations--
    changeInstalls((list) => list.filter((i) => i.installId !== install.installId))
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
