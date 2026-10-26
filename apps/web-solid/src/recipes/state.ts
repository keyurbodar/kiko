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
import { createRoot, createSignal, onCleanup } from "solid-js"
import { openFile } from "../chat/side/surfaces"
import { agentDisplayName } from "../lib/names"
import { room } from "../state/room"
import { createQuery, edit, load, owner } from "../state/runtime"
import { user } from "../state/user"
import { RECIPES } from "./catalog.gen"
import { installedSlugs } from "./model"
import { postEdit, postInstall, deleteInstall, updateRecipeRoutine } from "./api"

type Edit = (installs: readonly RecipeInstall[]) => readonly RecipeInstall[]

const listingAtom = () => owner.queries.recipes(undefined)
const [followers, setFollowers] = createSignal(0)
const listing = createRoot(() => createQuery(() => (followers() > 0 ? listingAtom() : null)))
const [owning, setOwning] = createSignal<ReadonlySet<string>>(new Set())
const [editing, setEditing] = createSignal<ReadonlySet<string>>(new Set())

export const cards = (): readonly RecipeCard[] => listing()?.cards ?? RECIPES

export const refreshListing = (): Promise<void> =>
  load(listingAtom(), { refresh: true }).then(
    () => undefined,
    () => undefined,
  )

export function followRecipes(): void {
  setFollowers((n) => n + 1)
  onCleanup(() => setFollowers((n) => n - 1))
  void refreshListing()
}

const editInstalls = <B>(change: Edit, send: () => Promise<B>): Promise<B> =>
  edit(owner.queries.recipes, undefined, (list) => ({ ...list, installs: change(list.installs) }), send)

export const broken = (): readonly string[] => listing()?.broken ?? []

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

export const installs = (): readonly RecipeInstall[] => listing()?.installs ?? []
export const knownInstalls = (): readonly RecipeInstall[] | undefined =>
  listing() === undefined && listing.error === undefined ? undefined : installs()
export const installsFor = (slug: string): readonly RecipeInstall[] => installs().filter((i) => i.slug === slug)
export function agentName(slug: string): string {
  return agentDisplayName(slug, user.agents())
}
export const isAdded = (slug: string, target?: RecipeTarget): boolean =>
  !!target && installedSlugs(installs(), target).has(slug)

export function setInstallPaused(install: RecipeInstall, paused: boolean): void {
  const status = paused ? "paused" : "active"
  const pause: Edit = (all) =>
    all.map((i) =>
      i.installId === install.installId
        ? { ...i, routines: i.routines.map((r): RecipeRoutine => ({ ...r, status })) }
        : i,
    )
  void editInstalls(pause, () => Promise.all(install.routines.map((r) => updateRecipeRoutine(r.id, status)))).then(
    (done) => {
      if (done.every(Boolean)) return
      showToastV2({ title: paused ? "Could not pause it" : "Could not resume it", variant: "error" })
    },
  )
}

export function removeInstall(install: RecipeInstall): void {
  let refused = ""
  void editInstalls(
    (list) => list.filter((i) => i.installId !== install.installId),
    async () => {
      const result = await deleteInstall(install.installId)
      if (!result.ok) throw new Error((refused = result.error))
    },
  ).catch(() => showToastV2({ title: "Could not remove recipe", description: refused, variant: "error" }))
}

export const isOwning = (slug: string): boolean => owning().has(slug)

const mark = (set: (update: (s: ReadonlySet<string>) => ReadonlySet<string>) => void, slug: string, on: boolean) =>
  set((s) => {
    const next = new Set(s)
    if (on) next.add(slug)
    else next.delete(slug)
    return next
  })

const including =
  (install: RecipeInstall): Edit =>
  (list) => [...list.filter((i) => i.installId !== install.installId), install]

const FRESH_MS = 1200
const FRESH_VALID_MS = 60_000
const fresh = new Map<string, { at: number; shown?: number }>()

const markFresh = (slug: string) => fresh.set(slug, { at: Date.now() })

export function freshElapsed(slug: string): number | undefined {
  const found = fresh.get(slug)
  if (!found) return undefined
  const now = Date.now()
  if (found.shown === undefined && now - found.at > FRESH_VALID_MS) return void fresh.delete(slug)
  found.shown ??= now
  if (now - found.shown >= FRESH_MS) return void fresh.delete(slug)
  return now - found.shown
}

const recorded = (install: RecipeInstall) => {
  if (!fresh.has(install.slug)) markFresh(install.slug)
  void editInstalls(including(install), () => Promise.resolve())
}

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
  const optimistic = ready(card)
  if (optimistic) {
    markFresh(card.slug)
    navigate(target.roomId)
  } else mark(setWaiting, card.slug, true)
  void editInstalls(optimistic ? including(install) : (list) => list, async () => {
    const made = await submit(card, body, navigate)
    if (!made) throw new Error("not added")
    return made
  }).then(
    (made) => {
      mark(setWaiting, card.slug, false)
      recorded(made)
      if (!optimistic) navigate(target.roomId)
    },
    () => mark(setWaiting, card.slug, false),
  )
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
