import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js"
import { user } from "../state/user"
import { connection } from "../state/connection"
import { owner as runtime, run } from "../state/runtime"
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
import { isDarkThemeId, type ThemeId } from "@kiko/theme/palette"
import { hasAuth } from "../lib/storage"
import { DEFAULT_LOOK, formatLook, isCurrentLook, parseLook, type Look } from "@kiko/theme/look"

const cached = readCache()
const signedInBefore = hasAuth()
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

let started = false
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
  const text = outbox
  if (text === undefined || !started || !connection.connected()) return
  void run(runtime.commands.setTheme, text).then((result) => {
    if (result._tag === "Success" && outbox === text) outbox = undefined
  })
}

export function saveLook(next: Look): void {
  const text = formatLook(next)
  adopt(text)
  outbox = text
  flush()
}

export const updateLook = (patch: Partial<Look>) => saveLook({ ...look(), ...patch })

export const previewLook = (next: Look): (() => void) => preview({ ...next })

export function startTheme(userId: string): void {
  if (owner === userId) return
  stopTheme()
  owner = userId
  applyCommitted(look())
  started = true
  stops.push(
    createRoot((dispose) => {
      createEffect(() => {
        if (user.synced()) setSynced(true)
      })
      createEffect(
        on(
          () => user.theme(),
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
      createEffect(on(connection.connected, (connected) => connected && flush(), { defer: true }))
      return dispose
    }),
  )
  flush()
}

export function stopTheme(): void {
  for (const stop of stops) stop()
  stops = []
  started = false
  owner = null
}

export function forgetTheme(): void {
  stopTheme()
  outbox = undefined
  adopt(null, false)
}

const DEFAULT = ""

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

export function pickTheme(appearance: "light" | "dark", id: string): void {
  const active = { ...themes().active }
  if (isDarkThemeId(id) || id === "snow") delete active[appearance]
  else active[appearance] = id
  const darkTheme = isDarkThemeId(id) ? id : look().darkTheme
  saveLook({ ...look(), darkTheme, imported: { ...themes(), active } })
}
