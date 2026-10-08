// Settings, appearance, laid out as monocode's (MIT, src/features/settings/ui/SettingsView.tsx):
// a few titled groups of rows. Theme, color, translucency and the chat background are
// monocode's own settings. The theme list is kiko's addition: t3code's built-in themes and the
// ones imported from a file or Open VSX, each one quiet row.
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ImageIcon, PlusIcon, SearchIcon, ShareIcon, TrashIcon } from "@kiko/ui/icons"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { For, Show, Suspense, createEffect, createSignal, lazy, onCleanup, untrack, type JSX } from "solid-js"
import { appearanceOf } from "./apply"
import { BUILT_IN_THEMES } from "./builtins"
import { cn } from "../lib/cn"
import { buttonClass, choiceRowClass, Group, iconButtonClass, Radio, rowLine } from "../settings/kit"
import { background, chooseBackground, DEFAULT_GLASS, glass, picture, removeBackground, setBackground, setGlass } from "./glass"
import { allThemes, chooseTheme, customThemes, look, matchWallpaper, removeThemes, updateLook } from "./live"
import { formatDoc, fromDoc, toDoc } from "./appearance-json"
import { createOpenVsxSearch, OpenVsxRow } from "./theme-search"
import { DEFAULT_LOOK, matchesWallpaper } from "./look"
import { colorsForMode, monocodeColors, WALLPAPER_ID, wallpaperColors, serializeThemeFile, themeModes, type ThemeAppearance, type ThemeColors, type ThemeDefinition } from "./palette"

// The import dialog, with culori, fflate and the Open VSX client, loads on the first click.
const ThemeImportDialog = lazy(() => import("./theme-import-dialog"))

function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revoking at once can abort the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

const percent = (n: number) => Math.round(n * 100)
const shown = () => appearanceOf(look().mode)

/** A theme in miniature: its canvas in each mode it draws, with its accent as a dot. */
function Swatch(props: { colors: Partial<Record<ThemeAppearance, ThemeColors>> }): JSX.Element {
  const modes = () => (["light", "dark"] as const).filter((m) => props.colors[m])
  return (
    <span class="flex h-6 w-10 shrink-0 overflow-hidden rounded-md [box-shadow:inset_0_0_0_1px_var(--hairline)]" aria-hidden="true">
      <For each={modes()}>
        {(mode) => (
          <span class="grid flex-1 place-items-center" style={{ background: props.colors[mode]!.canvas }}>
            <span class="size-2 rounded-full" style={{ background: props.colors[mode]!.accent }} />
          </span>
        )}
      </For>
    </span>
  )
}

function ThemeRow(props: {
  id: string | null
  label: string
  note?: string
  colors: Partial<Record<ThemeAppearance, ThemeColors>>
  onPick?: () => void
  disabled?: boolean
  onExport?: () => void
  onRemove?: () => void
}): JSX.Element {
  const owned = () => (["light", "dark"] as const).filter((m) => look()[m] === props.id && props.colors[m])
  const active = () => look()[shown()] === props.id || (owned().length > 0 && !props.colors[shown()])
  return (
    <div
      class={cn("flex h-11 items-center pr-2", rowLine)}
      data-theme-row={props.id ?? "default"}
      aria-current={active() ? "true" : undefined}
    >
      {/* A theme is a choice: the row is its button, and its radio says so. */}
      <button
        type="button"
        role="radio"
        aria-checked={active()}
        disabled={props.disabled}
        class={cn(choiceRowClass, "min-w-0 flex-1 self-stretch disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent")}
        onClick={() => (props.onPick ? props.onPick() : chooseTheme(props.id))}
      >
        <Radio on={active()} />
        <Swatch colors={props.colors} />
        <span class="min-w-0 flex-1 truncate text-[13px] text-text">{props.label}</span>
        <Show when={props.note}>
          <span class="shrink-0 text-xs text-muted">{props.note}</span>
        </Show>
        <Show when={owned().length === 1}>
          <span class="shrink-0 text-xs text-muted">{owned()[0]} mode</span>
        </Show>
      </button>
      <Show when={props.onExport}>
        <button type="button" class={iconButtonClass} title="export theme file" aria-label={`export ${props.label}`} onClick={() => props.onExport!()}>
          <HugeIcon icon={ShareIcon} size={14} />
        </button>
      </Show>
      <Show when={props.onRemove}>
        <button
          type="button"
          class={cn(iconButtonClass, "hover:text-[var(--danger)]")}
          title="remove theme"
          aria-label={`remove ${props.label}`}
          data-action="remove-theme"
          onClick={() => props.onRemove!()}
        >
          <HugeIcon icon={TrashIcon} size={14} />
        </button>
      </Show>
    </div>
  )
}

/** The theme read from the chat background itself. It recolors whenever the picture changes. */
function WallpaperRow(): JSX.Element {
  const palette = () => look().wallpaper ?? background()?.palette ?? null
  return (
    <ThemeRow
      id={WALLPAPER_ID}
      label="match wallpaper"
      note={background() ? (matchesWallpaper(look()) ? "follows your picture" : "from your picture") : "add a chat background first"}
      colors={palette() ? { light: wallpaperColors(palette()!, "light"), dark: wallpaperColors(palette()!, "dark") } : {}}
      disabled={!background() && !look().wallpaper}
      onPick={() => (background() ? void matchWallpaper() : look().wallpaper && updateLook({ light: WALLPAPER_ID, dark: WALLPAPER_ID }))}
    />
  )
}

const colorsOf = (theme: ThemeDefinition) => Object.fromEntries(themeModes(theme).map((m) => [m, colorsForMode(theme, m)!])) as Partial<Record<ThemeAppearance, ThemeColors>>
const noteOf = (theme: ThemeDefinition) => {
  const modes = themeModes(theme)
  return modes.length === 1 ? `${modes[0]} only` : undefined
}

function ThemeGroup(): JSX.Element {
  const [importOpen, setImportOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const vsx = createOpenVsxSearch(onThemesAdded)
  const remove = (theme: ThemeDefinition) => {
    if (!removeThemes([theme.id])) return void showToastV2({ title: "couldn't remove the theme. try again", variant: "error" })
    showToastV2({ title: `${theme.label.toLowerCase()} removed`, description: "import its file to bring it back" })
  }
  // One search: it narrows the installed themes and looks up the same words on Open VSX.
  const matches = (label: string) => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    return words.every((w) => label.toLowerCase().includes(w))
  }
  const searching = () => query().trim().length > 0
  const faint = "text-[12px] text-[color-mix(in_oklab,var(--text)_45%,transparent)]"
  return (
    <Group
      title="themes"
      description="a theme takes every mode it draws. one that draws only light or dark leaves the other mode as it was."
      action={
        <button type="button" class={buttonClass()} data-action="add-theme" onClick={() => setImportOpen(true)}>
          <HugeIcon icon={PlusIcon} size={13} />
          import file
        </button>
      }
      id="themes"
    >
      <div class={cn("flex h-11 items-center gap-2.5 px-4", rowLine)}>
        <span class="text-[color-mix(in_oklab,var(--text)_40%,transparent)]" classList={{ "animate-pulse": vsx.searching() }}>
          <HugeIcon icon={SearchIcon} size={14} />
        </span>
        <input
          type="search"
          class="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-[color-mix(in_oklab,var(--text)_40%,transparent)]"
          placeholder="search your themes and open vsx"
          aria-label="search themes"
          spellcheck={false}
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            vsx.search(e.currentTarget.value)
          }}
          data-component="theme-search"
        />
      </div>
      <div data-component="theme-library">
        <Show when={!searching() || matches("default")}>
          <ThemeRow id={null} label="default" note="tint in the json" colors={{ light: monocodeColors(look().tint, "light"), dark: monocodeColors(look().tint, "dark") }} />
        </Show>
        <Show when={!searching() || matches("match wallpaper")}>
          <WallpaperRow />
        </Show>
        <For each={BUILT_IN_THEMES.filter((t) => !searching() || matches(t.label))}>{(theme) => <ThemeRow id={theme.id} label={theme.label.toLowerCase()} colors={colorsOf(theme)} />}</For>
        <For each={customThemes().filter((t) => !searching() || matches(t.label))}>
          {(theme) => (
            <ThemeRow
              id={theme.id}
              label={theme.label.toLowerCase()}
              note={noteOf(theme) ?? (theme.collection && theme.collection.label !== theme.label ? theme.collection.label.toLowerCase() : undefined)}
              colors={colorsOf(theme)}
              onExport={() => download(`${theme.id}.json`, serializeThemeFile(theme))}
              onRemove={() => remove(theme)}
            />
          )}
        </For>
      </div>
      <Show when={searching()}>
        <div class={cn("flex h-8 items-end px-4 pb-1.5", faint)}>on open vsx</div>
        <Show when={vsx.error()}>
          <p class="px-4 pb-3 text-[12px] text-[var(--danger)]" role="alert">
            {vsx.error()}
          </p>
        </Show>
        <Show when={vsx.results()} fallback={<p class={cn("px-4 pb-3", faint)}>{vsx.searching() ? "searching…" : ""}</p>}>
          {(list) => (
            <div data-component="theme-results">
              <For each={list()} fallback={<p class={cn("px-4 pb-3", faint)}>no supported themes found. try a broader search.</p>}>
                {(extension) => <OpenVsxRow extension={extension} search={vsx} />}
              </For>
            </div>
          )}
        </Show>
      </Show>
      <Show when={importOpen()}>
        <Suspense>
          <ThemeImportDialog onClose={() => setImportOpen(false)} onImported={onThemesAdded} />
        </Suspense>
      </Show>
    </Group>
  )
}

function BackgroundGroup(): JSX.Element {
  let input: HTMLInputElement | undefined
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.toLowerCase() : "that picture couldn't be used")
    } finally {
      setBusy(false)
    }
  }
  const pick = (file: File | undefined) => {
    if (input) input.value = ""
    if (file) void run(() => chooseBackground(file))
  }
  const bg = background
  return (
    <Group title="chat background" description="a picture behind your chats. it stays on this device; how it shows is in the json below." id="chat-background">
      <div>
        <div>
          <Show
            when={bg() && picture()}
            fallback={
              <button
                type="button"
                disabled={busy()}
                class="flex h-36 w-full flex-col items-center justify-center gap-2 text-faint outline-none hover:bg-[var(--hover-bg)] hover:text-muted focus-visible:bg-[var(--hover-bg)] disabled:opacity-40"
                data-action="choose-background"
                onClick={() => input?.click()}
              >
                <HugeIcon icon={ImageIcon} size={20} />
                <span class="text-xs">{busy() ? "reading picture…" : "choose an image"}</span>
              </button>
            }
          >
            <div class="relative h-36" classList={{ "bg-[var(--bg)]": bg()!.effect === "gradient-blur" }}>
              <Show
                when={bg()!.effect === "gradient-blur"}
                fallback={<div aria-hidden="true" class="size-full bg-cover bg-center bg-no-repeat" style={{ "background-image": "var(--chat-background-image)", opacity: bg()!.empty }} />}
              >
                <div aria-hidden="true" class="gradient-blur-background gradient-blur-preview absolute inset-0" style={{ opacity: bg()!.empty }}>
                  <span class="gradient-blur-background-soft" />
                  <span class="gradient-blur-background-strong" />
                </div>
              </Show>
              <span class="pointer-events-none absolute bottom-2 left-2 text-[11px] text-faint">empty chat preview at {percent(bg()!.empty)}%</span>
            </div>
          </Show>
        </div>
        <input ref={input} type="file" accept="image/*" class="hidden" data-slot="background-file-input" onChange={(e) => pick(e.currentTarget.files?.[0])} />
        <Show when={bg()}>
          <div class={cn("flex items-center justify-end gap-2 px-4 py-2.5", "border-t border-[color-mix(in_oklab,var(--text)_6%,transparent)]")}>
            <button type="button" class={buttonClass()} disabled={busy()} onClick={() => input?.click()}>
              {busy() ? "reading…" : "change"}
            </button>
            <button type="button" class={buttonClass("danger")} disabled={busy()} data-action="remove-background" onClick={() => void run(removeBackground)}>
              remove
            </button>
          </div>
        </Show>
        <Show when={error()}>
          <p class="px-4 pb-3 text-xs text-[var(--danger)]" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </Group>
  )
}

/** Back to kiko's defaults: dark, the stock theme with no tint, accent, or token, monocode's glass, no picture. */
function restoreDefaults(): void {
  updateLook({ mode: DEFAULT_LOOK.mode, light: null, dark: null, themes: [], wallpaper: null, tint: DEFAULT_LOOK.tint, accent: null, tokens: DEFAULT_LOOK.tokens })
  setGlass(DEFAULT_GLASS)
  if (background()) void removeBackground()
}

const onThemesAdded = (themes: ThemeDefinition[], updated: boolean) => {
  const verb = updated ? "updated" : "added"
  const first = themes[0]
  if (themes.length === 1 && first) {
    chooseTheme(first.id)
    showToastV2({ title: `${first.label.toLowerCase()} ${verb}`, variant: "success" })
  } else {
    showToastV2({ title: `${themes.length} themes ${verb}`, description: themes.map((t) => t.label.toLowerCase()).join(", "), variant: "success" })
  }
}

/**
 * Everything else, as json: mode, theme per half, accent, tint, glass, how the background shows,
 * and css variables over any theme's. A valid edit applies a moment after typing stops; an
 * invalid one says what is wrong and where, and changes nothing.
 */
function JsonGroup(): JSX.Element {
  const current = () => toDoc(look(), glass(), background())
  const text = () => formatDoc(current())
  const [draft, setDraft] = createSignal(text())
  const [error, setError] = createSignal<string | null>(null)
  const [editing, setEditing] = createSignal(false)
  // While the field is not being edited it follows the settings, so a theme picked above shows here.
  createEffect(() => {
    const next = text()
    if (!untrack(editing)) {
      setDraft(next)
      setError(null)
    }
  })
  const themeIds = () => new Set([...allThemes().map((t) => t.id), ...(look().wallpaper || background()?.palette ? [WALLPAPER_ID] : [])])
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const apply = (value: string) => {
    const out = fromDoc(value, current(), themeIds())
    if (!out.ok) return setError(out.error)
    setError(null)
    const v = out.value
    const wantsWallpaper = v.look.light === WALLPAPER_ID || v.look.dark === WALLPAPER_ID
    updateLook({ ...v.look, wallpaper: wantsWallpaper ? (look().wallpaper ?? background()?.palette ?? null) : null })
    setGlass(v.glass)
    if (background()) setBackground(v.background)
  }
  const onInput = (value: string) => {
    setDraft(value)
    clearTimeout(timer)
    timer = setTimeout(() => apply(value), 400)
  }
  return (
    <Group
      title="settings.json"
      description="mode, theme, accent, tint, glass, the background, and tokens: any css variable over the theme's, per mode. edits apply as you type."
      id="appearance-json"
      action={
        <>
          <button type="button" class={buttonClass("ghost")} data-action="copy-appearance" onClick={() => void navigator.clipboard?.writeText(draft())}>
            copy
          </button>
          <button type="button" class={buttonClass()} data-action="restore-appearance" onClick={restoreDefaults}>
            reset
          </button>
        </>
      }
    >
      <textarea
        class="block min-h-[30rem] w-full resize-y bg-transparent px-4 py-3.5 font-mono text-[12px] leading-[1.6] text-text outline-none [tab-size:2]"
        spellcheck={false}
        autocomplete="off"
        aria-label="appearance settings json"
        aria-invalid={error() ? true : undefined}
        data-component="appearance-json"
        value={draft()}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false)
          if (!error()) setDraft(text())
        }}
        onInput={(e) => onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "Tab" || e.shiftKey) return
          e.preventDefault()
          const el = e.currentTarget
          el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end")
          onInput(el.value)
        }}
      />
      <Show when={error()}>
        <p class="border-t border-[color-mix(in_oklab,var(--text)_8%,transparent)] px-4 py-2.5 font-mono text-[12px] text-[var(--danger)]" role="alert" data-component="appearance-json-error">
          {error()}
        </p>
      </Show>
    </Group>
  )
}

export default function Appearance(): JSX.Element {
  return (
    <div class="flex flex-col gap-8" data-component="appearance" data-appearance-now={shown()}>
      <ThemeGroup />
      <BackgroundGroup />
      <JsonGroup />
    </div>
  )
}
