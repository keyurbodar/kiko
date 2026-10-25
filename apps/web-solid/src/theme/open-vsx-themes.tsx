import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, CloseIcon, SearchIcon } from "@kiko/ui/icons"
import { SearchField } from "@kiko/ui/v2/search-field"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { appearanceOf } from "@kiko/theme/apply"
import { MAX_IMPORTED, type ImportedTheme } from "@kiko/theme/imported"
import type { OpenVsxItem, Send } from "@kiko/theme/open-vsx"
import { apiFetch } from "../lib/api"
import { cn } from "../lib/cn"
import { Dialog } from "../lib/dialog"
import { Button, Skeleton } from "../settings/kit"
import { look, remove, themes, wear } from "./live"
import "./open-vsx-themes.css"

const importer = () => import("@kiko/theme/open-vsx")
const SUGGESTIONS = ["Catppuccin", "Tokyo Night", "Rosé Pine", "Dracula"]
const SEARCH_PAUSE_MS = 250

type Install = { phase: "installing" } | { phase: "failed"; message: string; retryable: boolean }
type Search = { items: OpenVsxItem[] | null; loading: boolean; error: string | null }

const keyOf = (item: Pick<OpenVsxItem, "namespace" | "name">) => `${item.namespace}.${item.name}`
const isActive = (theme: ImportedTheme) => themes().active[theme.appearance] === theme.id
const isShowing = (theme: ImportedTheme) => isActive(theme) && appearanceOf(look().mode) === theme.appearance

function shortNames(labels: string[]): string[] {
  if (labels.length < 2) return labels
  const words = labels.map((label) => label.split(" "))
  let shared = 0
  while (words.every((w) => w.length > shared + 1 && w[shared] === words[0]![shared])) shared++
  return words.map((w) => w.slice(shared).join(" "))
}

function variantLine(item: OpenVsxItem): string {
  const names = shortNames(item.variants.map((v) => v.label))
  if (names.length === 0) return ""
  if (names.length === 1) return item.variants[0]!.appearance === "light" ? "Light theme" : "Dark theme"
  return `${names.length} themes: ${names.join(", ")}`
}

function ThemePreview(props: { theme: ImportedTheme }): JSX.Element {
  const p = () => props.theme.palette
  const syntax = () =>
    props.theme.syntax ?? { keyword: props.theme.accent, string: p().gold, func: p().text, comment: p().faint }
  return (
    <div
      class="theme-preview"
      aria-hidden="true"
      style={{
        "--tp-bg": p().canvas,
        "--tp-side": p().sidebar,
        "--tp-fg": p().text,
        "--tp-muted": p().muted,
        "--tp-accent": props.theme.accent,
        "--tp-kw": syntax().keyword,
        "--tp-str": syntax().string,
        "--tp-fn": syntax().func,
        "--tp-cm": syntax().comment,
      }}
    >
      <div data-slot="side">
        <span />
        <span />
        <span />
      </div>
      <div data-slot="code">
        <span>
          <span data-token="kw">const</span> <span data-token="fn">brew</span>()
        </span>
        <span data-token="str"> "matcha"</span>
        <span data-token="cm">// steep</span>
      </div>
      <span data-slot="bubble" />
    </div>
  )
}

function VariantCard(props: { theme: ImportedTheme; label: string; onRemove?: () => void }): JSX.Element {
  return (
    <div class="group/variant relative min-w-0">
      <button
        type="button"
        class="flex w-full cursor-pointer flex-col gap-1.5 text-left outline-none transition-transform duration-(--dur-hover) ease-kiko active:scale-[0.98]"
        aria-pressed={isShowing(props.theme)}
        aria-label={`Use ${props.theme.name}`}
        title={props.theme.name}
        data-variant={props.theme.id}
        onClick={() => wear(props.theme)}
      >
        <span
          class="relative block rounded-tile transition-shadow duration-(--dur-pop) ease-kiko group-focus-visible/variant:shadow-[var(--focus-ring)]"
          classList={{
            "shadow-[0_0_0_2px_var(--raise),0_0_0_3.5px_var(--fg2)]": isShowing(props.theme),
            "theme-preview-hover": !isShowing(props.theme),
          }}
        >
          <ThemePreview theme={props.theme} />
          <Show when={isActive(props.theme)}>
            <span
              class="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full"
              style={{ background: props.theme.palette.text, color: props.theme.palette.canvas }}
            >
              <RemixIcon icon={CheckIcon} size={10} />
            </span>
          </Show>
        </span>
        <span
          class="truncate type-label"
          classList={{ "font-semibold text-fg": isShowing(props.theme), "text-fg2": !isShowing(props.theme) }}
        >
          {props.label}
        </span>
      </button>
      <Show when={props.onRemove}>
        {(onRemove) => (
          <button
            type="button"
            class="theme-variant-remove absolute top-1.5 left-1.5 grid size-5 cursor-pointer place-items-center rounded-control bg-raise text-fg2 shadow-menu hover:text-bad"
            aria-label={`Remove ${props.theme.name}`}
            title="Remove"
            onClick={() => onRemove()()}
          >
            <RemixIcon icon={CloseIcon} size={12} />
          </button>
        )}
      </Show>
    </div>
  )
}

function VariantGrid(props: { themes: ImportedTheme[]; removable?: boolean; class?: string }): JSX.Element {
  const labels = createMemo(() => shortNames(props.themes.map((t) => t.name)))
  return (
    <div class={cn("theme-variant-grid", props.class)} data-component="theme-variants">
      <For each={props.themes}>
        {(theme, index) => (
          <VariantCard
            theme={theme}
            label={labels()[index()] ?? theme.name}
            onRemove={props.removable ? () => remove(theme) : undefined}
          />
        )}
      </For>
    </div>
  )
}

function ExtensionIcon(props: { item: OpenVsxItem }): JSX.Element {
  const [broken, setBroken] = createSignal(false)
  return (
    <span class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-tile bg-panel" aria-hidden="true">
      <Show
        when={props.item.icon && !broken()}
        fallback={<span class="type-row text-fg3">{props.item.displayName.slice(0, 1).toUpperCase()}</span>}
      >
        <img
          src={props.item.icon!}
          alt=""
          width="40"
          height="40"
          loading="lazy"
          referrerpolicy="no-referrer"
          draggable={false}
          class="size-full object-cover"
          onError={() => setBroken(true)}
        />
      </Show>
    </span>
  )
}

function ResultRow(props: { item: OpenVsxItem; state?: Install; onInstall: () => void }): JSX.Element {
  const installed = createMemo(() => themes().themes.filter((t) => t.source === keyOf(props.item)))
  const failed = () => (props.state?.phase === "failed" ? props.state : null)
  const busy = () => props.state?.phase === "installing"
  return (
    <li
      class="flex flex-col gap-3 rounded-row px-2.5 py-2.5 transition-colors duration-(--dur-hover) ease-kiko theme-row-hover"
      data-item={keyOf(props.item)}
      data-state={installed().length > 0 ? "installed" : (props.state?.phase ?? "available")}
    >
      <div class="flex items-center gap-3">
        <ExtensionIcon item={props.item} />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate type-row text-fg">{props.item.displayName}</span>
          <span class="truncate type-label text-fg3">
            {props.item.namespace}, {props.item.downloadCount.toLocaleString("en-US")} installs
          </span>
          <Show when={!failed() && installed().length === 0 && variantLine(props.item)}>
            {(line) => <span class="truncate type-hint text-fg4">{line()}</span>}
          </Show>
        </div>
        <Show
          when={installed().length === 0}
          fallback={
            <span class="flex shrink-0 items-center gap-1 type-label text-fg3">
              <RemixIcon icon={CheckIcon} size={14} />
              Installed
            </span>
          }
        >
          <Show when={!failed() || failed()!.retryable}>
            <Button class="shrink-0" busy={busy()} onClick={() => props.onInstall()}>
              {failed() ? "Try again" : "Install"}
            </Button>
          </Show>
        </Show>
      </div>
      <Show when={failed()}>
        {(state) => (
          <p role="alert" class="pl-[52px] type-label text-bad" data-slot="install-error">
            {state().message}
          </p>
        )}
      </Show>
      <Show when={installed().length > 0}>
        <VariantGrid themes={installed()} class="theme-variant-grid--nested" />
      </Show>
    </li>
  )
}

function SkeletonRows(): JSX.Element {
  return (
    <For each={[0, 1, 2, 3]}>
      {() => (
        <li class="flex items-center gap-3 px-2.5 py-2.5" aria-hidden="true">
          <Skeleton class="size-10 rounded-tile" />
          <div class="flex flex-1 flex-col gap-1.5">
            <Skeleton class="h-3.5 w-2/5" />
            <Skeleton class="h-3 w-1/4" />
          </div>
        </li>
      )}
    </For>
  )
}

function Message(props: { title: string; children?: JSX.Element }): JSX.Element {
  return (
    <div class="flex flex-col items-center gap-3 px-6 py-12 text-center" data-slot="message">
      <span class="grid size-10 place-items-center rounded-full bg-panel text-fg3">
        <RemixIcon icon={SearchIcon} size={18} />
      </span>
      <p class="type-ui text-fg2">{props.title}</p>
      {props.children}
    </div>
  )
}

function Installed(props: { onSuggest: (query: string) => void }): JSX.Element {
  return (
    <Show
      when={themes().themes.length > 0}
      fallback={
        <Message title="Bring any VS Code color theme into Kiko.">
          <div class="flex flex-wrap justify-center gap-1.5">
            <For each={SUGGESTIONS}>
              {(name) => (
                <button
                  type="button"
                  class="h-7 cursor-pointer rounded-full bg-panel px-3 type-label text-fg2 transition-[background-color,color,transform] duration-(--dur-hover) ease-kiko hover:bg-hover hover:text-fg active:scale-[0.97]"
                  onClick={() => props.onSuggest(name)}
                >
                  {name}
                </button>
              )}
            </For>
          </div>
        </Message>
      }
    >
      <div class="flex flex-col gap-2 px-2.5 pb-2">
        <h3 class="flex h-section-label items-center type-label text-fg3">Installed</h3>
        <VariantGrid themes={themes().themes} removable />
      </div>
    </Show>
  )
}

export function ThemeBrowser(props: { open: boolean; onClose: () => void; send?: Send }) {
  const send = () => props.send ?? apiFetch
  const [query, setQuery] = createSignal("")
  const [attempt, setAttempt] = createSignal(0)
  const [search, setSearch] = createSignal<Search>({ items: null, loading: false, error: null })
  const [installs, setInstalls] = createSignal<Record<string, Install>>({})

  createEffect(
    on([query, attempt], ([text]) => {
      const q = text.trim()
      if (!q) {
        setSearch({ items: null, loading: false, error: null })
        return
      }
      setSearch((s) => ({ ...s, loading: true, error: null }))
      const abort = new AbortController()
      const timer = setTimeout(async () => {
        try {
          const items = await (await importer()).searchThemes(q, abort.signal, send())
          if (!abort.signal.aborted) setSearch({ items, loading: false, error: null })
        } catch (cause) {
          if (abort.signal.aborted) return
          const error = cause instanceof Error ? cause.message : "The search failed."
          setSearch({ items: null, loading: false, error })
        }
      }, SEARCH_PAUSE_MS)
      onCleanup(() => {
        clearTimeout(timer)
        abort.abort()
      })
    }),
  )

  const setInstall = (key: string, state: Install | null) =>
    setInstalls((all) => {
      const next = { ...all }
      if (state) next[key] = state
      else delete next[key]
      return next
    })

  async function install(item: OpenVsxItem) {
    const key = keyOf(item)
    setInstall(key, { phase: "installing" })
    const openVsx = await importer()
    try {
      const added = await openVsx.installTheme(item, undefined, send())
      const kept = themes().themes.filter((theme) => !added.some((a) => a.id === theme.id))
      const pick = added.find((t) => t.appearance === appearanceOf(look().mode)) ?? added[0]!
      wear(pick, [...kept, ...added].slice(-MAX_IMPORTED))
      setInstall(key, null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The install failed."
      const retryable = !(cause instanceof openVsx.OpenVsxError) || cause.retryable
      setInstall(key, { phase: "failed", message, retryable })
    }
  }

  const close = () => {
    setQuery("")
    setInstalls({})
    props.onClose()
  }

  const busy = () => Object.values(installs()).some((state) => state.phase === "installing")

  return (
    <Dialog
      open={props.open}
      onClose={close}
      title="Themes"
      description="Color themes from Open VSX, the open VS Code marketplace."
      size="md"
      class="h-[min(680px,88dvh)] w-[min(640px,calc(100vw-32px))]"
      bodyClass="@container/themes flex flex-col gap-3 overflow-hidden px-3 pb-3"
      data-component="theme-browser"
    >
      <div class="px-2 pt-1">
        <SearchField
          size="large"
          placeholder="Search Open VSX"
          aria-label="Search Open VSX"
          value={query()}
          onValue={setQuery}
          ref={(el) => requestAnimationFrame(() => el.focus())}
        />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto" aria-busy={search().loading || busy() || undefined}>
        <Show when={query().trim()} fallback={<Installed onSuggest={setQuery} />}>
          <Show
            when={!search().error}
            fallback={
              <Message title={search().error!}>
                <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
              </Message>
            }
          >
            <Show when={search().items} fallback={<ul>{<SkeletonRows />}</ul>}>
              {(items) => (
                <Show
                  when={items().length > 0}
                  fallback={<Message title={`Nothing on Open VSX matches “${query().trim()}”.`} />}
                >
                  <ul class="flex flex-col gap-0.5" classList={{ "opacity-60": search().loading }}>
                    <For each={items()}>
                      {(item) => (
                        <ResultRow item={item} state={installs()[keyOf(item)]} onInstall={() => void install(item)} />
                      )}
                    </For>
                  </ul>
                </Show>
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </Dialog>
  )
}
