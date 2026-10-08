// Settings, appearance, laid out as monocode's (MIT, src/features/settings/ui/SettingsView.tsx):
// a few titled groups of rows. Theme, color, translucency and the chat background are
// monocode's own settings. The theme list is kiko's addition: t3code's built-in themes and the
// ones imported from a file or Open VSX, each one quiet row.
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ImageIcon, PlusIcon } from "@kiko/ui/icons"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { For, Show, Suspense, createSignal, lazy, type JSX } from "solid-js"
import { appearanceOf } from "./apply"
import { BUILT_IN_THEMES } from "./builtins"
import { cn } from "../lib/cn"
import { buttonClass, Group, Row, Segmented, Slider, Toggle } from "../settings/kit"
import { background, BACKGROUND_EFFECTS, BLUR_RADIUS, chooseBackground, DEFAULT_GLASS, EFFECT_DESCRIPTIONS, EFFECT_LABELS, glass, picture, removeBackground, setBackground, setGlass, SIDEBAR_OPACITY, VISIBILITY } from "./glass"
import { chooseTheme, customThemes, look, matchWallpaper, removeThemes, setHalf, updateLook } from "./live"
import { ThemeCard, themeGridClass } from "./theme-cards"
import { ThemeSearch } from "./theme-search"
import { DEFAULT_LOOK, type Mode } from "./look"
import { ACCENT_PRESETS, colorsForMode, monocodeColors, WALLPAPER_ID, wallpaperColors, serializeThemeFile, themeModes, TINT_RANGE, type ThemeAppearance, type ThemeColors, type ThemeDefinition } from "./palette"

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

const colorsOf = (theme: ThemeDefinition) => Object.fromEntries(themeModes(theme).map((m) => [m, colorsForMode(theme, m)!])) as Partial<Record<ThemeAppearance, ThemeColors>>
const noteOf = (theme: ThemeDefinition) => {
  const modes = themeModes(theme)
  return modes.length === 1 ? `${modes[0]} only` : undefined
}

/** The modes a theme id is set for. */
const modesOf = (id: string | null): ThemeAppearance[] => (["light", "dark"] as const).filter((m) => look()[m] === id)

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

/** The themes, as t3code's card grid: kiko's own, the picture's, the built-ins, then the imported ones. */
function ThemeGroup(): JSX.Element {
  const [importOpen, setImportOpen] = createSignal(false)
  const remove = (theme: ThemeDefinition) => {
    if (!removeThemes([theme.id])) return void showToastV2({ title: "couldn't remove the theme. try again", variant: "error" })
    showToastV2({ title: `${theme.label.toLowerCase()} removed`, description: "import its file to bring it back" })
  }
  const palette = () => look().wallpaper ?? background()?.palette ?? null
  const useWallpaper = (mode?: ThemeAppearance) => {
    if (!mode) return void (background() ? matchWallpaper() : look().wallpaper && updateLook({ light: WALLPAPER_ID, dark: WALLPAPER_ID }))
    if (palette()) updateLook({ [mode]: WALLPAPER_ID, wallpaper: palette() })
  }
  // A theme that draws one mode takes only that half; one that draws both takes both.
  const use = (theme: ThemeDefinition) => {
    const modes = themeModes(theme)
    if (modes.length === 1) setHalf(modes[0]!, theme.id)
    else chooseTheme(theme.id)
  }
  return (
    <Group
      title="themes"
      description="the name sets a theme for every mode it draws. a ball sets it for that mode only."
      action={
        <button type="button" class={buttonClass()} data-action="add-theme" onClick={() => setImportOpen(true)}>
          <HugeIcon icon={PlusIcon} size={13} />
          import file
        </button>
      }
      id="themes"
      bare
    >
      <div class={themeGridClass} data-component="theme-library">
        <ThemeCard
          id="default"
          label="kiko"
          colors={{ light: monocodeColors(look().tint, "light"), dark: monocodeColors(look().tint, "dark") }}
          activeModes={modesOf(null)}
          onUse={() => chooseTheme(null)}
          onUseMode={(mode) => setHalf(mode, null)}
        />
        <ThemeCard
          id={WALLPAPER_ID}
          label="match wallpaper"
          note={palette() ? undefined : "add a chat background first"}
          colors={palette() ? { light: wallpaperColors(palette()!, "light"), dark: wallpaperColors(palette()!, "dark") } : {}}
          activeModes={modesOf(WALLPAPER_ID)}
          disabled={!palette()}
          onUse={() => useWallpaper()}
          onUseMode={(mode) => useWallpaper(mode)}
        />
        <For each={BUILT_IN_THEMES}>
          {(theme) => <ThemeCard id={theme.id} label={theme.label.toLowerCase()} colors={colorsOf(theme)} activeModes={modesOf(theme.id)} onUse={() => use(theme)} onUseMode={(mode) => setHalf(mode, theme.id)} />}
        </For>
        <For each={customThemes()}>
          {(theme) => (
            <ThemeCard
              id={theme.id}
              label={theme.label.toLowerCase()}
              note={noteOf(theme)}
              colors={colorsOf(theme)}
              activeModes={modesOf(theme.id)}
              onUse={() => use(theme)}
              onUseMode={(mode) => setHalf(mode, theme.id)}
              onExport={() => download(`${theme.id}.json`, serializeThemeFile(theme))}
              onRemove={() => remove(theme)}
            />
          )}
        </For>
      </div>
      <Show when={importOpen()}>
        <Suspense>
          <ThemeImportDialog onClose={() => setImportOpen(false)} onImported={onThemesAdded} />
        </Suspense>
      </Show>
    </Group>
  )
}

/** Open VSX, t3code's community theme search: VS Code color themes, installed in a click. */
function OpenVsxGroup(): JSX.Element {
  return (
    <Group title="community themes" description="search open vsx for vs code color themes. an installed one joins the grid above." id="open-vsx" bare>
      <ThemeSearch onInstalled={onThemesAdded} />
    </Group>
  )
}

function AccentPicker(): JSX.Element {
  const choices = [null, ...ACCENT_PRESETS] as const
  const names: Record<string, string> = { default: "default", "#4da3f5": "blue", "#8b5cf6": "violet", "#ec4899": "pink", "#ef4444": "red", "#f59e0b": "orange", "#10b981": "green" }
  return (
    <div class="flex items-center gap-1.5" role="radiogroup" aria-label="accent color">
      <For each={choices}>
        {(color) => (
          <button
            type="button"
            role="radio"
            aria-checked={look().accent === color}
            aria-label={names[color ?? "default"]}
            title={names[color ?? "default"]}
            data-accent={color ?? "default"}
            class="grid size-6 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:shadow-[0_0_0_2px_var(--bg),0_0_0_3.5px_var(--text)]"
            onClick={() => updateLook({ accent: color })}
          >
            <span class="block size-5 rounded-full" style={{ background: color ?? "var(--text)" }} />
          </button>
        )}
      </For>
    </div>
  )
}

function ColorGroups(): JSX.Element {
  const tint = () => look().tint
  const lightNow = () => shown() === "light"
  const onStock = () => look()[shown()] === null
  return (
    <>
      <Group title="interface" description="dark and light share the same tint, so the color settings below apply to both.">
        <Row label="mode" description="system follows the os appearance.">
          <Segmented<Mode>
            label="theme"
            value={look().mode}
            options={[
              { value: "system", label: "system" },
              { value: "dark", label: "dark" },
              { value: "light", label: "light" },
            ]}
            onChange={(mode) => updateLook({ mode })}
          />
        </Row>
        <Row label="accent color" description="used for the send button and your message bubbles.">
          <AccentPicker />
        </Row>
      </Group>
      <Group
        title="color"
        description={onStock() ? "hue and saturation tint every surface. lightness only moves the dark theme." : "these tint kiko's own theme. pick kiko in themes to see them."}
      >
        <Row label="hue" description="base hue for tinted surfaces.">
          <Slider label="hue" value={tint().hue} display={`${tint().hue}°`} min={TINT_RANGE.hue.min} max={TINT_RANGE.hue.max} onChange={(hue) => updateLook({ tint: { ...tint(), hue } })} />
        </Row>
        <Row label="saturation" description="how strongly the hue tints the interface. zero keeps it neutral.">
          <Slider
            label="saturation"
            value={tint().saturation}
            display={`${tint().saturation}%`}
            min={TINT_RANGE.saturation.min}
            max={TINT_RANGE.saturation.max}
            onChange={(saturation) => updateLook({ tint: { ...tint(), saturation } })}
          />
        </Row>
        <Row
          label="dark-mode lightness"
          description={lightNow() ? "this only affects dark mode. your dark-mode value is kept." : "base brightness of the dark theme. lower is darker; zero is true black."}
        >
          <Slider
            label="dark-mode lightness"
            value={tint().lightness}
            display={`${tint().lightness}%`}
            min={TINT_RANGE.lightness.min}
            max={TINT_RANGE.lightness.max}
            disabled={lightNow()}
            onChange={(lightness) => updateLook({ tint: { ...tint(), lightness } })}
          />
        </Row>
      </Group>
    </>
  )
}

function TranslucencyGroup(): JSX.Element {
  const off = () => shown() === "light"
  return (
    <Group
      title="translucency"
      description={
        off()
          ? "light mode always uses an opaque window, so these are off. your dark-mode values are kept."
          : "how much of the chat background shows through kiko, as if it were your desktop. blur costs more to draw the higher it goes."
      }
    >
      <Row label="sidebar opacity" description="applies to the sidebar and the other glass panes.">
        <Slider
          label="sidebar opacity"
          value={percent(glass().opacity)}
          display={`${percent(glass().opacity)}%`}
          min={percent(SIDEBAR_OPACITY.min)}
          max={percent(SIDEBAR_OPACITY.max)}
          disabled={off()}
          onChange={(p) => setGlass({ opacity: p / 100 })}
        />
      </Row>
      <Row label="blur radius" description="background blur behind the window.">
        <Slider label="blur radius" value={glass().blur} display={String(glass().blur)} min={BLUR_RADIUS.min} max={BLUR_RADIUS.max} disabled={off()} onChange={(blur) => setGlass({ blur })} />
      </Row>
      <Row label="main pane glass" description="extend the translucent treatment to the chat pane and the info pane.">
        <Toggle label="main pane glass" on={glass().body} disabled={off()} onChange={(body) => setGlass({ body })} />
      </Row>
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
    <Group title="chat background" description="a picture behind your chats. it stays on this device." id="chat-background">
      <div class="p-4">
        <div class="overflow-hidden rounded-lg [box-shadow:inset_0_0_0_1px_var(--hairline)]">
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
          <div class="mt-3 flex items-center justify-end gap-2">
            <button type="button" class={buttonClass()} disabled={busy()} onClick={() => input?.click()}>
              {busy() ? "reading…" : "change"}
            </button>
            <button type="button" class={buttonClass("danger")} disabled={busy()} data-action="remove-background" onClick={() => void run(removeBackground)}>
              remove
            </button>
          </div>
        </Show>
        <Show when={error()}>
          <p class="mt-2 text-xs text-[var(--danger)]" role="alert">
            {error()}
          </p>
        </Show>
      </div>
      <Show when={bg()}>
        {(b) => (
          <>
            <Row label="background effect" description={EFFECT_DESCRIPTIONS[b().effect]}>
              <Segmented label="background effect" value={b().effect} options={BACKGROUND_EFFECTS.map((e) => ({ value: e, label: EFFECT_LABELS[e] }))} onChange={(effect) => setBackground({ effect })} />
            </Row>
            <Row label="show on" description="empty chats only, or every chat.">
              <Segmented
                label="show background on"
                value={b().scope}
                options={[
                  { value: "empty", label: "empty only" },
                  { value: "all", label: "all chats" },
                ]}
                onChange={(scope) => setBackground({ scope })}
              />
            </Row>
            <Row label="empty chat visibility" description="background strength before a chat has messages.">
              <Slider
                label="empty chat background visibility"
                value={percent(b().empty)}
                display={`${percent(b().empty)}%`}
                min={percent(VISIBILITY.min)}
                max={percent(VISIBILITY.max)}
                onChange={(p) => setBackground({ empty: p / 100 })}
              />
            </Row>
            <Row label="chat visibility" description="background strength once the chat has messages.">
              <Slider
                label="chat background visibility"
                value={percent(b().session)}
                display={`${percent(b().session)}%`}
                min={percent(VISIBILITY.min)}
                max={percent(VISIBILITY.max)}
                onChange={(p) => setBackground({ session: p / 100 })}
              />
            </Row>
          </>
        )}
      </Show>
    </Group>
  )
}

/**
 * Monocode's restore defaults (SettingsView.tsx `restoreDefaults`): dark, the stock theme with no
 * tint or accent, monocode's glass, and no chat background.
 */
function restoreDefaults(): void {
  updateLook({ mode: DEFAULT_LOOK.mode, light: null, dark: null, themes: [], wallpaper: null, tint: DEFAULT_LOOK.tint, accent: null })
  setGlass(DEFAULT_GLASS)
  if (background()) void removeBackground()
}

export default function Appearance(): JSX.Element {
  return (
    <div class="flex flex-col gap-8" data-component="appearance" data-appearance-now={shown()}>
      <ThemeGroup />
      <OpenVsxGroup />
      <ColorGroups />
      <TranslucencyGroup />
      <BackgroundGroup />
      <div class="flex justify-end">
        <button type="button" class={buttonClass()} data-action="restore-appearance" onClick={restoreDefaults}>
          restore defaults
        </button>
      </div>
    </div>
  )
}
