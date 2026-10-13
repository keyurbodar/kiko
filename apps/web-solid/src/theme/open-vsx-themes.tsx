// Settings, Open VSX: search the Open VSX registry for color themes, install one as Kiko's palette,
// apply it, or remove it. The importer loads on the first search, so the settings route does not
// carry it.
import { createSignal, For, Show, type JSX } from "solid-js"
import { appearanceOf, importedThemes, saveImported } from "@kiko/theme/apply"
import { MAX_IMPORTED, themeFor, type Imported, type ImportedTheme } from "@kiko/theme/imported"
import type { OpenVsxItem } from "@kiko/theme/open-vsx"
import { buttonClass, Empty, Group, Item, Notice, Pill } from "../settings/kit"
import { look, updateLook } from "./live"

const importer = () => import("@kiko/theme/open-vsx")

export function OpenVsxThemes(): JSX.Element {
  const [query, setQuery] = createSignal("")
  const [results, setResults] = createSignal<OpenVsxItem[] | null>(null)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal<{ message: string; retry: () => void } | null>(null)
  const [state, setState] = createSignal<Imported>(importedThemes())

  const commit = (next: Imported) => {
    saveImported(next)
    setState(next)
  }
  const useTheme = (theme: ImportedTheme) => {
    commit({ ...state(), active: { ...state().active, [theme.appearance]: theme.id } })
    updateLook({ mode: theme.appearance })
  }
  const failWith = (cause: unknown, retry: () => void) =>
    setError({ message: cause instanceof Error ? cause.message : "Something went wrong.", retry })

  async function search() {
    const text = query().trim()
    if (!text) return
    setBusy("search")
    setError(null)
    try {
      setResults(await (await importer()).searchThemes(text))
    } catch (cause) {
      failWith(cause, search)
    } finally {
      setBusy(null)
    }
  }

  async function install(item: OpenVsxItem) {
    setBusy(`${item.namespace}.${item.name}`)
    setError(null)
    try {
      const themes = await (await importer()).installTheme(item)
      const kept = state().themes.filter((theme) => !themes.some((added) => added.id === theme.id))
      commit({ ...state(), themes: [...kept, ...themes].slice(-MAX_IMPORTED) })
      useTheme(themes.find((theme) => theme.appearance === appearanceOf(look().mode)) ?? themes[0]!)
    } catch (cause) {
      failWith(cause, () => install(item))
    } finally {
      setBusy(null)
    }
  }

  function remove(theme: ImportedTheme) {
    const active = { ...state().active }
    for (const appearance of ["light", "dark"] as const) if (active[appearance] === theme.id) delete active[appearance]
    commit({ themes: state().themes.filter((other) => other.id !== theme.id), active })
  }

  return (
    <Group title="Open VSX" description="Install a VS Code color theme. Its colors become Kiko's palette, and the layout stays the same.">
      <form
        class="flex items-center gap-2 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <input
          class="kit-field min-w-0 flex-1"
          type="search"
          aria-label="Search themes"
          placeholder="Search themes"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <button type="submit" class={buttonClass("secondary")} disabled={busy() !== null || query().trim() === ""}>
          Search
        </button>
      </form>
      <Show when={error()}>
        {(failure) => (
          <div class="px-4 pb-3">
            <Notice tone="danger">
              {failure().message}{" "}
              <button type="button" class={buttonClass("ghost")} onClick={() => failure().retry()}>
                Try again
              </button>
            </Notice>
          </div>
        )}
      </Show>
      <Show when={results()}>
        {(found) => (
          <Show when={found().length > 0} fallback={<Empty>No color themes match.</Empty>}>
            <For each={found()}>
              {(item) => (
                <Item
                  title={item.displayName}
                  meta={`${item.namespace} · ${item.downloadCount.toLocaleString()} installs`}
                  actions={
                    <button type="button" class={buttonClass("secondary")} disabled={busy() !== null} onClick={() => void install(item)}>
                      {busy() === `${item.namespace}.${item.name}` ? "Installing" : "Install"}
                    </button>
                  }
                />
              )}
            </For>
          </Show>
        )}
      </Show>
      <For each={state().themes}>
        {(theme) => (
          <Item
            title={theme.name}
            meta={theme.source}
            actions={
              <div class="flex items-center gap-2">
                <Pill tone="muted">{theme.appearance === "dark" ? "Dark" : "Light"}</Pill>
                <Show
                  when={themeFor(state(), theme.appearance)?.id === theme.id}
                  fallback={
                    <button type="button" class={buttonClass("secondary")} onClick={() => useTheme(theme)}>
                      Apply
                    </button>
                  }
                >
                  <Pill tone="accent">Applied</Pill>
                </Show>
                <button type="button" class={buttonClass("ghost")} onClick={() => remove(theme)}>
                  Remove
                </button>
              </div>
            }
          />
        )}
      </For>
    </Group>
  )
}
