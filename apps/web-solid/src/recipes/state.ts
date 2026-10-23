import {
  type InstallRecipe,
  KIKO,
  type RecipeCard,
  type RecipeInstall,
  type RecipeNeedsConnect,
  type RecipeRoutine,
  type RoomId,
} from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal } from "solid-js"
import { openFile } from "../chat/side/surfaces"
import { agentDisplayName } from "../lib/names"
import { room } from "../state/room"
import { user } from "../state/user"
import { installedSlugs } from "./model"
import {
  cardsOf,
  fetchListing,
  loadListing,
  type Listing,
  postEdit,
  postInstall,
  deleteInstall,
  cacheListing,
  updateRecipeRoutine,
} from "./api"

const [listing, setListing] = createSignal<Listing>(loadListing())
const [owning, setOwning] = createSignal<ReadonlySet<string>>(new Set())
const [editing, setEditing] = createSignal<ReadonlySet<string>>(new Set())
let pending: Promise<void> | undefined
let revision = 0
let mutations = 0

export const cards = (): readonly RecipeCard[] => cardsOf(listing())

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

export const broken = (): readonly string[] => listing().broken ?? []

export const isEditing = (slug: string): boolean => editing().has(slug)

export async function editRecipe(slug: string, navigate: (roomId: string) => void): Promise<void> {
  if (editing().has(slug)) return
  const roomId = user.kikoChatId()
  setEditing((set) => new Set(set).add(slug))
  const path = await postEdit(slug).finally(() => setEditing((set) => new Set([...set].filter((s) => s !== slug))))
  if (!roomId || !path) return void showToastV2({ title: "Could not open the recipe", variant: "error" })
  openFile(roomId, `home/${path}`)
  navigate(roomId)
}

export type RecipeTarget = { roomId: RoomId; agent: string; name: string }

export function targetsForChat(roomId: string): RecipeTarget[] {
  if (room.activeId() === roomId && room.roomMembers().length)
    return room.roomMembers().map((m) => ({ roomId: roomId as RoomId, agent: m.slug, name: m.name }))
  const chat = user.chats().find((c) => c.roomId === roomId)
  if (!chat) return []
  const agents = user.agents()
  const slugs = (chat.agents?.length ? chat.agents : [KIKO]).map((id) => agents.find((a) => a.id === id)?.slug ?? id)
  if (slugs.length > 1 && !slugs.includes(KIKO)) slugs.unshift(KIKO)
  return [...new Set(slugs)].map((agent) => ({ roomId: roomId as RoomId, agent, name: agentName(agent) }))
}

export const installs = (): readonly RecipeInstall[] => listing().installs
export const installsFor = (slug: string): readonly RecipeInstall[] => listing().installs.filter((i) => i.slug === slug)
export function agentName(slug: string): string {
  return agentDisplayName(slug, user.agents())
}
export const isAdded = (slug: string, target?: RecipeTarget): boolean =>
  !!target && installedSlugs(listing().installs, target).has(slug)

export function setInstallPaused(install: RecipeInstall, paused: boolean): void {
  const status = paused ? "paused" : "active"
  const before = new Map(install.routines.map((r) => [r.id, r.status]))
  const put = (pick: (r: RecipeRoutine) => RecipeRoutine["status"]) =>
    changeInstalls((all) =>
      all.map((i) =>
        i.installId === install.installId ? { ...i, routines: i.routines.map((r) => ({ ...r, status: pick(r) })) } : i,
      ),
    )
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

const recorded = (install: RecipeInstall) =>
  changeInstalls((list) => [...list.filter((i) => i.installId !== install.installId), install])

const failed = (card: RecipeCard, error: string) =>
  showToastV2({ title: `Could not add ${card.title}`, description: error, variant: "error" })

export type ConnectAsk = {
  card: RecipeCard
  body: InstallRecipe
  navigate: (roomId: string) => void
  connect: RecipeNeedsConnect
}

const [ask, setAsk] = createSignal<ConnectAsk | null>(null)
const [waiting, setWaiting] = createSignal<ReadonlySet<string>>(new Set())
export const connectAsk = ask
export const dismissConnect = () => setAsk(null)
export const isWaiting = (slug: string): boolean => waiting().has(slug)

async function submit(
  card: RecipeCard,
  body: InstallRecipe,
  navigate: (roomId: string) => void,
): Promise<RecipeInstall | null> {
  const result = await postInstall(body)
  if (result.ok) {
    setAsk(null)
    return result.install
  }
  if ("connect" in result) setAsk({ card, body, navigate, connect: result.connect })
  else failed(card, result.error)
  return null
}

const ready = (card: RecipeCard) => card.apps.every((a) => a.connected === true)

export function addToTarget(
  card: RecipeCard,
  target: RecipeTarget | undefined,
  navigate: (roomId: string) => void,
): void {
  if (!target || isAdded(card.slug, target) || isWaiting(card.slug)) return
  const install: RecipeInstall = {
    installId: crypto.randomUUID(),
    slug: card.slug,
    roomId: target.roomId,
    agent: target.agent,
    at: Date.now(),
    routines: [],
  }
  const body: InstallRecipe = {
    installId: install.installId,
    slug: card.slug,
    roomId: target.roomId,
    agent: target.agent,
  }
  mutations++
  const optimistic = ready(card)
  if (optimistic) {
    recorded(install)
    navigate(target.roomId)
  } else mark(setWaiting, card.slug, true)
  void submit(card, body, navigate).then((made) => {
    mutations--
    mark(setWaiting, card.slug, false)
    changeInstalls((list) => list.filter((i) => i.installId !== install.installId))
    if (!made) return
    recorded(made)
    if (!optimistic) navigate(target.roomId)
  })
}

export function addOwnChat(card: RecipeCard, navigate: (roomId: string) => void): void {
  mark(setOwning, card.slug, true)
  void submit(card, { installId: crypto.randomUUID(), slug: card.slug, own: true }, navigate).then((made) => {
    mark(setOwning, card.slug, false)
    if (!made) return
    recorded(made)
    navigate(made.roomId)
  })
}

export function retryConnect(): void {
  const pending = ask()
  if (!pending || isWaiting(pending.card.slug)) return
  const { card, body, navigate } = pending
  mark(setWaiting, card.slug, true)
  void submit(card, body, navigate).then((made) => {
    mark(setWaiting, card.slug, false)
    if (!made) return
    recorded(made)
    navigate(made.roomId)
  })
}
