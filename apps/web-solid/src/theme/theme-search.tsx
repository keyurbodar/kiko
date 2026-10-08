// Open VSX theme search, after t3code's (MIT, apps/web/src/components/settings/ThemeSearchSection.tsx):
// search the open registry of VS Code extensions for color themes and install one in a click.
// The appearance page runs it from the themes list's own search, and draws each hit as a row of
// that list, so there is one list and one search.
import { HugeIcon } from "@kiko/ui/huge-icon"
import { AppearanceIcon } from "@kiko/ui/icons"
import { debounce } from "@solid-primitives/scheduled"
import { Show, createSignal, onCleanup, type JSX } from "solid-js"
import { buttonClass } from "../settings/kit"
import { customThemes, installThemes } from "./live"
import { importOpenVsxExtension, searchOpenVsxThemes, type OpenVsxExtension } from "./openvsx"
import type { ThemeDefinition } from "./palette"

const FORMAT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })

const lower = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback).toLowerCase()

export function createOpenVsxSearch(onInstalled: (themes: ThemeDefinition[], updated: boolean) => void) {
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
      const found = await searchOpenVsxThemes(trimmed, { signal: controller.signal, sortBy: "downloadCount" })
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
        onInstalled(themes, updated)
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(lower(cause, "that theme couldn't be added"))
    }
    if (request === controller) request = null
    setInstalling(null)
  }

  return {
    /** Searches a moment after typing stops; an empty query clears the results. */
    search: (text: string) => later(text),
    results,
    error,
    searching,
    installing,
    install,
  }
}

function ExtensionIcon(props: { extension: OpenVsxExtension }): JSX.Element {
  const [failed, setFailed] = createSignal(false)
  return (
    <span class="grid size-6 shrink-0 place-items-center overflow-hidden rounded-md bg-[color-mix(in_oklab,var(--text)_6%,transparent)] text-muted">
      <Show when={props.extension.iconUrl && !failed()} fallback={<HugeIcon icon={AppearanceIcon} size={13} />}>
        <img alt="" class="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" src={props.extension.iconUrl!} onError={() => setFailed(true)} />
      </Show>
    </span>
  )
}

/** An Open VSX theme as a row of the themes list: its icon, name, publisher and downloads, and install. */
export function OpenVsxRow(props: { extension: OpenVsxExtension; search: ReturnType<typeof createOpenVsxSearch> }): JSX.Element {
  const busy = () => props.search.installing() === props.extension.id
  const installed = () => customThemes().some((t) => t.collection?.id === props.extension.collectionId)
  const label = () => (busy() ? (installed() ? "updating…" : "installing…") : installed() ? "update" : "install")
  return (
    <div class="flex h-11 items-center gap-3 px-4" data-extension={props.extension.id}>
      <ExtensionIcon extension={props.extension} />
      <span class="min-w-0 flex-1 truncate text-[13px] text-text">
        {props.extension.name.toLowerCase()}
        <span class="ml-2 text-[12px] text-[color-mix(in_oklab,var(--text)_45%,transparent)]">
          {props.extension.publisher.toLowerCase()} · {FORMAT.format(props.extension.downloadCount)}
        </span>
      </span>
      <button
        type="button"
        class={buttonClass()}
        disabled={props.search.installing() !== null}
        aria-label={`${label()} ${props.extension.name}`}
        data-action="install-theme"
        onClick={() => void props.search.install(props.extension)}
      >
        {label()}
      </button>
    </div>
  )
}
