// Ported from t3code (MIT), apps/web/src/components/settings/ThemeSearchSection.tsx, in kiko's
// own controls: search Open VSX for color themes and install one in a click.
import { HugeIcon } from "@kiko/ui/huge-icon"
import { AppearanceIcon, ExternalIcon, SearchIcon } from "@kiko/ui/icons"
import { debounce } from "@solid-primitives/scheduled"
import { For, Show, createSignal, onCleanup, type JSX } from "solid-js"
import { buttonClass } from "../settings/kit"
import { customThemes, installThemes } from "./live"
import { importOpenVsxExtension, searchOpenVsxThemes, type OpenVsxExtension, type OpenVsxSort } from "./openvsx"
import type { ThemeDefinition } from "./palette"

const FORMAT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
const SUGGESTIONS = ["dracula", "catppuccin", "nord", "tokyo night"]
const SORTS: Array<{ value: OpenVsxSort; label: string }> = [
  { value: "downloadCount", label: "most downloaded" },
  { value: "rating", label: "best rated" },
  { value: "timestamp", label: "newest" },
  { value: "relevance", label: "most relevant" },
]

const lower = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback).toLowerCase()

function ExtensionIcon(props: { extension: OpenVsxExtension }): JSX.Element {
  const [failed, setFailed] = createSignal(false)
  return (
    <div class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--bg-subtle)] text-muted">
      <Show when={props.extension.iconUrl && !failed()} fallback={<HugeIcon icon={AppearanceIcon} size={16} />}>
        <img alt="" class="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" src={props.extension.iconUrl!} onError={() => setFailed(true)} />
      </Show>
    </div>
  )
}

export function ThemeSearch(props: { onInstalled: (themes: ThemeDefinition[], updated: boolean) => void }): JSX.Element {
  const [query, setQuery] = createSignal("")
  const [sortBy, setSortBy] = createSignal<OpenVsxSort>("downloadCount")
  const [results, setResults] = createSignal<OpenVsxExtension[] | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [searching, setSearching] = createSignal(false)
  const [installing, setInstalling] = createSignal<string | null>(null)
  let request: AbortController | null = null
  onCleanup(() => request?.abort())

  const run = async (text: string) => {
    const trimmed = text.trim()
    request?.abort()
    if (!trimmed) {
      request = null
      setResults(null)
      setError(null)
      setSearching(false)
      return
    }
    const controller = new AbortController()
    request = controller
    setError(null)
    setSearching(true)
    try {
      const found = await searchOpenVsxThemes(trimmed, { signal: controller.signal, sortBy: sortBy() })
      if (!controller.signal.aborted) setResults(found)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setResults(null)
        setError(lower(cause, "open vsx search failed"))
      }
    }
    if (request === controller) {
      request = null
      setSearching(false)
    }
  }
  const later = debounce((text: string) => void run(text), 350)

  const install = async (extension: OpenVsxExtension) => {
    setError(null)
    request?.abort()
    const controller = new AbortController()
    request = controller
    setSearching(false)
    setInstalling(extension.id)
    const updated = customThemes().some((t) => t.collection?.id === extension.collectionId)
    try {
      const themes = await importOpenVsxExtension(extension, controller.signal)
      if (!controller.signal.aborted) {
        if (!installThemes(themes)) throw new Error("installed themes couldn't be saved in this browser")
        props.onInstalled(themes, updated)
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(lower(cause, "that theme couldn't be added"))
    }
    if (request === controller) request = null
    setInstalling(null)
  }

  const search = (text: string) => {
    setQuery(text)
    later.clear()
    void run(text)
  }

  return (
    <section class="flex flex-col gap-3" data-component="theme-search">
      <label class="flex h-10 items-center gap-2 rounded-xl bg-input px-3 focus-within:ring-2 focus-within:ring-[var(--accent)]">
        <span class="text-muted" classList={{ "animate-pulse": searching() }}>
          <HugeIcon icon={SearchIcon} size={16} />
        </span>
        <input
          aria-label="search open vsx themes"
          type="search"
          placeholder="search themes…"
          class="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-faint"
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            later(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (event.isComposing) return
            if (event.key === "Enter" && installing() === null) search(query())
          }}
        />
      </label>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <p class="text-xs text-muted">popular</p>
          <For each={SUGGESTIONS}>
            {(suggestion) => (
              <button
                type="button"
                class="h-7 rounded-lg px-2 text-xs text-muted outline-none hover:bg-[var(--hover-bg)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40"
                disabled={installing() !== null}
                data-suggestion={suggestion}
                onClick={() => search(suggestion)}
              >
                {suggestion}
              </button>
            )}
          </For>
        </div>
        <Show when={results()?.length}>
          <label class="flex shrink-0 items-center justify-end gap-2 text-xs text-muted">
            sort
            <select
              aria-label="sort themes"
              class="h-7 rounded-lg bg-input px-2 text-xs text-text outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              disabled={installing() !== null}
              value={sortBy()}
              onChange={(event) => {
                setSortBy(event.currentTarget.value as OpenVsxSort)
                void run(query())
              }}
            >
              <For each={SORTS}>{(sort) => <option value={sort.value}>{sort.label}</option>}</For>
            </select>
          </label>
        </Show>
      </div>
      <div class="sr-only" role="status">
        {searching() ? "searching themes…" : results() ? `${results()!.length} supported ${results()!.length === 1 ? "theme" : "themes"} found` : ""}
      </div>
      <Show when={error()}>
        <p class="rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-xs text-[var(--danger)]" role="alert" aria-live="polite">
          {error()}
        </p>
      </Show>
      <Show when={searching() && results() === null}>
        <div class="flex min-h-20 items-center justify-center text-sm text-muted">searching themes…</div>
      </Show>
      <Show when={results()}>
        {(list) => (
          <Show
            when={list().length > 0}
            fallback={
              <div class="flex min-h-32 flex-col items-center justify-center rounded-2xl bg-[var(--card)] text-center">
                <p class="text-sm font-medium">no supported open-source themes found</p>
                <p class="mt-1 text-xs text-muted">try a broader search.</p>
              </div>
            }
          >
            <div class="grid gap-2 sm:grid-cols-2" data-component="theme-results">
              <For each={list()}>
                {(extension) => {
                  const busy = () => installing() === extension.id
                  const installed = () => customThemes().some((t) => t.collection?.id === extension.collectionId)
                  const label = () => (busy() ? (installed() ? "updating…" : "installing…") : installed() ? "update" : "install")
                  return (
                    <article class="flex min-w-0 flex-col gap-3 rounded-xl bg-[var(--card)] p-3" data-extension={extension.id}>
                      <div class="flex min-w-0 gap-3">
                        <ExtensionIcon extension={extension} />
                        <div class="min-w-0 flex-1">
                          <h4 class="truncate text-sm font-medium">{extension.name}</h4>
                          <p class="truncate text-xs text-muted">
                            {extension.publisher} · {FORMAT.format(extension.downloadCount)} downloads
                          </p>
                        </div>
                      </div>
                      <p class="line-clamp-2 min-h-8 text-xs leading-4 text-muted">{extension.description || "a community color theme for your editor."}</p>
                      <div class="mt-auto flex items-center justify-between gap-2">
                        <Show when={extension.sourceUrl} fallback={<span />}>
                          <a
                            href={extension.sourceUrl!}
                            target="_blank"
                            rel="noreferrer"
                            class="grid size-7 place-items-center rounded-lg text-muted outline-none hover:bg-[var(--hover-bg)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            aria-label={`view source for ${extension.name}`}
                          >
                            <HugeIcon icon={ExternalIcon} size={14} />
                          </a>
                        </Show>
                        <button
                          type="button"
                          class={buttonClass()}
                          disabled={installing() !== null}
                          aria-label={`${label()} ${extension.name}`}
                          data-action="install-theme"
                          onClick={() => void install(extension)}
                        >
                          {label()}
                        </button>
                      </div>
                    </article>
                  )
                }}
              </For>
            </div>
          </Show>
        )}
      </Show>
    </section>
  )
}
