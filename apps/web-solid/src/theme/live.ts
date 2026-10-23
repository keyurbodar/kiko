import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js"
import { useApp } from "../lib/store"
import { type UserChannel, userChannel } from "../sync/socket"
import {
  applyCommitted,
  dropLegacyImported,
  legacyImported,
  previewLook as preview,
  readCache,
  selectBuiltin,
  writeCache,
} from "@kiko/theme/apply"
import { type Imported, type ImportedTheme, MAX_IMPORTED } from "@kiko/theme/imported"
import { setAvatarPicks } from "../avatar/picks"
import type { ThemeId } from "@kiko/theme/palette"
import { read } from "../lib/api-base"
import { DEFAULT_LOOK, formatLook, isCurrentLook, parseLook, type Look } from "@kiko/theme/look"

const cached = readCache()
const signedInBefore = read("kiko:session") !== null
let legacy: Imported | null = signedInBefore ? legacyImported() : null
if (!legacy?.themes.length) legacy = null
const first = signedInBefore ? withThemes(parseLook(cached?.text ?? null), legacy) : DEFAULT_LOOK
applyCommitted(first, signedInBefore)
setAvatarPicks(first.avatars)
const [saved, setSaved] = createSignal<string | null>(cached?.text ?? null)

function withThemes(base: Look, extra: Imported | null): Look {
  if (!extra) return base
  const known = new Set(base.imported.themes.map((t) => t.id))
  return {
    ...base,
    imported: {
      themes: [...base.imported.themes, ...extra.themes.filter((t) => !known.has(t.id))].slice(-MAX_IMPORTED),
      active: { ...extra.active, ...base.imported.active },
    },
  }
}

export const look = createRoot(() => createMemo(() => parseLook(saved())))
export const hasLook = () => saved() !== null
const [synced, setSynced] = createSignal(cached !== null)
export const lookSynced = synced

let channel: UserChannel | null = null
let stops: (() => void)[] = []
let owner: string | null = null
let outbox: string | null | undefined

function adopt(text: string | null, withImported = true): void {
  const next = parseLook(text)
  applyCommitted(next, withImported)
  setAvatarPicks(next.avatars)
  writeCache(text, next)
  if (text !== saved()) setSaved(text)
}

function flush(): void {
  if (outbox === undefined || !channel) return
  if (channel.send({ t: "theme", theme: outbox })) outbox = undefined
}

export function saveLook(next: Look): void {
  const text = formatLook(next)
  adopt(text)
  outbox = text
  flush()
}

export const updateLook = (patch: Partial<Look>) => saveLook({ ...look(), ...patch })

export const previewLook = (next: Look): (() => void) => preview({ ...next })

export function startTheme(userId: string, shared: UserChannel = userChannel): void {
  if (owner === userId) return
  stopTheme()
  owner = userId
  applyCommitted(look())
  channel = shared
  stops.push(
    createRoot((dispose) => {
      createEffect(() => {
        if (useApp.user()?.state.synced) setSynced(true)
      })
      createEffect(
        on(
          () => useApp.user()?.state.theme,
          (theme) => {
            if (theme === undefined || outbox !== undefined) return
            if (legacy) {
              const base = isCurrentLook(theme) || !isCurrentLook(saved()) ? parseLook(theme) : look()
              saveLook(withThemes(base, legacy))
              legacy = null
              return dropLegacyImported()
            }
            if (theme === saved()) return
            if (isCurrentLook(theme) || !isCurrentLook(saved())) return adopt(theme)
            outbox = saved()
            flush()
          },
        ),
      )
      return dispose
    }),
    shared.onOpen(flush),
  )
  flush()
}

export function stopTheme(): void {
  for (const stop of stops) stop()
  stops = []
  channel = null
  owner = null
}

export function forgetTheme(): void {
  stopTheme()
  outbox = undefined
  adopt(null, false)
}

export const DEFAULT = ""

export const themes = () => look().imported

export function commit(next: Imported) {
  saveLook({ ...look(), imported: next })
}

export function choose(appearance: "light" | "dark", id: string) {
  const active = { ...themes().active }
  if (id === DEFAULT) delete active[appearance]
  else active[appearance] = id
  commit({ ...themes(), active })
}

export function remove(theme: ImportedTheme) {
  const active = { ...themes().active }
  for (const appearance of ["light", "dark"] as const) if (active[appearance] === theme.id) delete active[appearance]
  commit({ themes: themes().themes.filter((other) => other.id !== theme.id), active })
}

export function chooseBuiltin(id: ThemeId): void {
  saveLook(selectBuiltin(look(), id))
}
