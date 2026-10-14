// Settings, themes: the installed VS Code themes, which one each appearance uses, and the Open VSX
// browser. The importer loads on the first search, so the settings route does not carry it.
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { appearanceOf, importedThemes, saveImported } from "@kiko/theme/apply"
import { MAX_IMPORTED, type Imported, type ImportedTheme } from "@kiko/theme/imported"
import type { OpenVsxItem } from "@kiko/theme/open-vsx"
import { Dialog } from "../lib/dialog"
import { Button, IconButton, Notice } from "../settings/kit"
import { look, updateLook } from "./live"

const importer = () => import("@kiko/theme/open-vsx")
export const DEFAULT = ""

const [state, setState] = createSignal<Imported>(importedThemes())

/** The installed themes and which one each appearance uses. */
export const themes = state

function commit(next: Imported) {
  saveImported(next)
  setState(next)
}

export function choose(appearance: "light" | "dark", id: string) {
  const active = { ...state().active }
  if (id === DEFAULT) delete active[appearance]
  else active[appearance] = id
  commit({ ...state(), active })
}

export function remove(theme: ImportedTheme) {
  const active = { ...state().active }
  for (const appearance of ["light", "dark"] as const) if (active[appearance] === theme.id) delete active[appearance]
  commit({ themes: state().themes.filter((other) => other.id !== theme.id), active })
}

export function ThemeBrowser(props: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = createSignal("")
  const [results, setResults] = createSignal<OpenVsxItem[] | null>(null)
  const [searching, setSearching] = createSignal(false)
  const [installing, setInstalling] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(
    on(query, (text) => {
      const q = text.trim()
      if (!q) {
        setResults(null)
        return
      }
      const abort = new AbortController()
      const timer = setTimeout(async () => {
        setSearching(true)
        setError(null)
        try {
          const found = await (await importer()).searchThemes(q, abort.signal)
          if (!abort.signal.aborted) setResults(found)
        } catch (cause) {
          if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "The search failed.")
        } finally {
          if (!abort.signal.aborted) setSearching(false)
        }
      }, 250)
      onCleanup(() => {
        clearTimeout(timer)
        abort.abort()
      })
    }),
  )

  const keyOf = (item: OpenVsxItem) => `${item.namespace}.${item.name}`
  const installed = (item: OpenVsxItem) => state().themes.some((t) => t.source === keyOf(item))

  async function install(item: OpenVsxItem) {
    setInstalling(keyOf(item))
    setError(null)
    try {
      const themes = await (await importer()).installTheme(item)
      const kept = state().themes.filter((theme) => !themes.some((added) => added.id === theme.id))
      commit({ ...state(), themes: [...kept, ...themes].slice(-MAX_IMPORTED) })
      const theme = themes.find((t) => t.appearance === appearanceOf(look().mode)) ?? themes[0]!
      choose(theme.appearance, theme.id)
      updateLook({ mode: theme.appearance })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The install failed.")
    } finally {
      setInstalling(null)
    }
  }

  const close = () => {
    setQuery("")
    setError(null)
    props.onClose()
  }

  return (
    <Dialog open={props.open} onClose={close} title="Themes" size="md" class="h-[min(560px,86dvh)]" bodyClass="flex flex-col gap-2 overflow-hidden px-3" data-component="theme-browser">
      <input
        type="search"
        class="kit-field mx-2"
        placeholder="Search Open VSX"
        aria-label="Search Open VSX"
        autocomplete="off"
        value={query()}
        ref={(el) => requestAnimationFrame(() => el.focus())}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <Show when={error()}>{(message) => <div class="px-2"><Notice>{message()}</Notice></div>}</Show>
      <ul class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Show
          when={results()}
          fallback={
            <>
              <li class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">Installed</li>
              <For each={state().themes} fallback={<li class="px-2 py-1 text-sm text-muted-foreground">None yet. Search for one above.</li>}>
                {(theme) => (
                  <li class="flex h-9 items-center gap-2 rounded-md px-2 hover:bg-accent" data-theme={theme.id}>
                    <span class="min-w-0 flex-1 truncate text-md text-foreground">{theme.name}</span>
                    <span class="shrink-0 text-xs text-muted-foreground">{theme.appearance === "dark" ? "Dark" : "Light"}</span>
                    <IconButton label={`Remove ${theme.name}`} danger onClick={() => remove(theme)}>
                      <svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </IconButton>
                  </li>
                )}
              </For>
            </>
          }
        >
          {(found) => (
            <For each={found()} fallback={<li class="px-2 py-1 text-sm text-muted-foreground">{searching() ? "Searching" : "No color themes match."}</li>}>
              {(item) => (
                <li class="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-accent" data-item={keyOf(item)}>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-md text-foreground">{item.displayName}</span>
                    <span class="truncate text-xs text-muted-foreground">
                      {item.namespace} · {item.downloadCount.toLocaleString()} installs
                    </span>
                  </div>
                  <Show when={!installed(item)} fallback={<span class="shrink-0 text-xs text-muted-foreground">Installed</span>}>
                    <Button disabled={installing() !== null} onClick={() => void install(item)}>
                      {installing() === keyOf(item) ? "Installing" : "Install"}
                    </Button>
                  </Show>
                </li>
              )}
            </For>
          )}
        </Show>
      </ul>
    </Dialog>
  )
}
