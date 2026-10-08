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
import { allThemes, chooseTheme, customThemes, look, matchWallpaper, removeThemes, setHalf, updateLook } from "./live"
import { ThemeSelect, type ThemeOption } from "./theme-select"
import { Select } from "../settings/select"
import { CHAT_WIDTHS, CODE_FONTS, CONTRAST, DEFAULT_DISPLAY, INTERFACE_FONTS, TEXT_SIZES, type Display } from "./display"
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
const ONLY: Record<ThemeAppearance, string> = { light: "Light only", dark: "Dark only" }
const shown = () => appearanceOf(look().mode)

const colorsOf = (theme: ThemeDefinition) => Object.fromEntries(themeModes(theme).map((m) => [m, colorsForMode(theme, m)!])) as Partial<Record<ThemeAppearance, ThemeColors>>
const noteOf = (theme: ThemeDefinition) => {
  const modes = themeModes(theme)
  return modes.length === 1 ? ONLY[modes[0]!] : undefined
}

const onThemesAdded = (themes: ThemeDefinition[], updated: boolean) => {
  const verb = updated ? "updated" : "added"
  const first = themes[0]
  if (themes.length === 1 && first) {
    chooseTheme(first.id)
    showToastV2({ title: `${first.label} ${verb}`, variant: "success" })
  } else {
    showToastV2({ title: `${themes.length} themes ${verb}`, description: themes.map((t) => t.label).join(", "), variant: "success" })
  }
}

const removeTheme = (theme: ThemeDefinition) => {
  if (!removeThemes([theme.id])) return void showToastV2({ title: "Couldn't remove the theme. Try again.", variant: "error" })
  showToastV2({ title: `${theme.label} removed`, description: "Import its file to bring it back." })
}

/**
 * Every theme, drawn in the mode on screen: kiko's own, the picture's when there is one, the
 * built-ins, then the imported ones. A theme that draws only the other mode shows its own colors.
 */
function themeOptions(): ThemeOption[] {
  const now = shown()
  const palette = look().wallpaper ?? background()?.palette ?? null
  const colors = (theme: ThemeDefinition) => colorsForMode(theme, now) ?? colorsForMode(theme, now === "dark" ? "light" : "dark")!
  const only = (theme: ThemeDefinition) => {
    const modes = themeModes(theme)
    return modes.length === 1 ? ONLY[modes[0]!] : undefined
  }
  return [
    { id: null, label: "Kiko", colors: monocodeColors(look().tint, now) },
    ...(palette ? [{ id: WALLPAPER_ID, label: "Match wallpaper", colors: wallpaperColors(palette, now) }] : []),
    ...BUILT_IN_THEMES.map((t) => ({ id: t.id, label: t.label, colors: colors(t) })),
    ...customThemes().map((t) => ({
      id: t.id,
      label: t.label,
      note: only(t),
      colors: colors(t),
      onExport: () => download(`${t.id}.json`, serializeThemeFile(t)),
      onRemove: () => removeTheme(t),
    })),
  ]
}

/** Picks a theme for every mode it draws; one that draws a single mode takes only that one. */
function pickTheme(id: string | null) {
  if (id === null) return chooseTheme(null)
  if (id === WALLPAPER_ID) return void (background() ? matchWallpaper() : updateLook({ light: WALLPAPER_ID, dark: WALLPAPER_ID }))
  const theme = allThemes().find((t) => t.id === id)
  if (!theme) return
  const modes = themeModes(theme)
  if (modes.length === 1) setHalf(modes[0]!, id)
  else chooseTheme(id)
}

function AccentPicker(): JSX.Element {
  const choices = [null, ...ACCENT_PRESETS] as const
  const names: Record<string, string> = { default: "Default", "#4da3f5": "Blue", "#8b5cf6": "Violet", "#ec4899": "Pink", "#ef4444": "Red", "#f59e0b": "Orange", "#10b981": "Green" }
  return (
    <div class="flex items-center gap-1.5" role="radiogroup" aria-label="Accent color">
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
  const [importOpen, setImportOpen] = createSignal(false)
  const tint = () => look().tint
  const lightNow = () => shown() === "light"
  const onStock = () => look()[shown()] === null
  return (
    <>
      <Group title="Theme" description="Dark and light share the same tint, so the color settings below apply to both.">
        <Row label="Mode" description="System follows the OS appearance." onReset={look().mode !== DEFAULT_LOOK.mode ? () => updateLook({ mode: DEFAULT_LOOK.mode }) : undefined}>
          <Segmented<Mode>
            label="Mode"
            value={look().mode}
            options={[
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={(mode) => updateLook({ mode })}
          />
        </Row>
        <Row label="Color theme" onReset={look().light !== null || look().dark !== null ? () => chooseTheme(null) : undefined}>
          <ThemeSelect value={look()[shown()]} options={themeOptions()} onPick={pickTheme} />
        </Row>
        <Row label="Accent color" description="Used for the send button and your message bubbles." onReset={look().accent !== null ? () => updateLook({ accent: null }) : undefined}>
          <AccentPicker />
        </Row>
        <Row label="More themes" description="VS Code themes from Open VSX, or a theme file.">
          <button type="button" class={buttonClass()} data-action="add-theme" onClick={() => setImportOpen(true)}>
            <HugeIcon icon={PlusIcon} size={13} />
            Add theme
          </button>
        </Row>
      </Group>
      <Show when={importOpen()}>
        <Suspense>
          <ThemeImportDialog onClose={() => setImportOpen(false)} onImported={onThemesAdded} />
        </Suspense>
      </Show>
      <Group
        title="Color"
        description={onStock() ? "Hue and saturation tint every surface. Lightness only moves the dark theme." : "These tint Kiko's own theme. Pick Kiko as the theme to see them."}
      >
        <Row label="Hue" onReset={tint().hue !== DEFAULT_LOOK.tint.hue ? () => updateLook({ tint: { ...tint(), hue: DEFAULT_LOOK.tint.hue } }) : undefined}>
          <Slider label="Hue" value={tint().hue} display={`${tint().hue}°`} min={TINT_RANGE.hue.min} max={TINT_RANGE.hue.max} onChange={(hue) => updateLook({ tint: { ...tint(), hue } })} />
        </Row>
        <Row
          label="Saturation"
          description="How strongly the hue tints the interface. Zero keeps it neutral."
          onReset={tint().saturation !== DEFAULT_LOOK.tint.saturation ? () => updateLook({ tint: { ...tint(), saturation: DEFAULT_LOOK.tint.saturation } }) : undefined}
        >
          <Slider
            label="Saturation"
            value={tint().saturation}
            display={`${tint().saturation}%`}
            min={TINT_RANGE.saturation.min}
            max={TINT_RANGE.saturation.max}
            onChange={(saturation) => updateLook({ tint: { ...tint(), saturation } })}
          />
        </Row>
        <Row
          label="Dark-mode lightness"
          description={lightNow() ? "This only affects dark mode. Your dark-mode value is kept." : "Base brightness of the dark theme. Zero is true black."}
          onReset={tint().lightness !== DEFAULT_LOOK.tint.lightness ? () => updateLook({ tint: { ...tint(), lightness: DEFAULT_LOOK.tint.lightness } }) : undefined}
        >
          <Slider
            label="Dark-mode lightness"
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

/** t3code's interface and font settings (display.ts), each with its reset while changed. */
function InterfaceGroups(): JSX.Element {
  const d = () => look().display
  const set = (patch: Partial<Display>) => updateLook({ display: { ...d(), ...patch } })
  const reset = <K extends keyof Display>(key: K) => (d()[key] !== DEFAULT_DISPLAY[key] ? () => set({ [key]: DEFAULT_DISPLAY[key] } as Partial<Display>) : undefined)
  const options = <T extends string>(table: Record<T, { label: string }>, fallback: T) =>
    (Object.keys(table) as T[]).map((value) => ({ value, label: value === fallback ? `${table[value].label} (default)` : table[value].label }))
  return (
    <>
      <Group title="Interface">
        <Row label="Contrast" description="Adjust the contrast of borders, lines, and fills across the interface." onReset={reset("contrast")}>
          <Slider label="Contrast" value={d().contrast} display={`${d().contrast}%`} min={CONTRAST.min} max={CONTRAST.max} step={CONTRAST.step} onChange={(contrast) => set({ contrast })} />
        </Row>
        <Row label="Text size" description="The size of text across Kiko, messages included." onReset={reset("textSize")}>
          <Select label="Text size" value={d().textSize} options={options(TEXT_SIZES, DEFAULT_DISPLAY.textSize)} onChange={(textSize) => set({ textSize })} />
        </Row>
        <Row label="Chat width" description="How wide messages and the composer can grow on large screens." onReset={reset("chatWidth")}>
          <Select label="Chat width" value={d().chatWidth} options={options(CHAT_WIDTHS, DEFAULT_DISPLAY.chatWidth)} onChange={(chatWidth) => set({ chatWidth })} />
        </Row>
      </Group>
      <Group title="Fonts">
        <Row label="Interface font" description="Everything outside code blocks." onReset={reset("interfaceFont")}>
          <Select label="Interface font" value={d().interfaceFont} options={options(INTERFACE_FONTS, DEFAULT_DISPLAY.interfaceFont)} onChange={(interfaceFont) => set({ interfaceFont })} />
        </Row>
        <Row label="Code font" description="Code blocks and inline code." onReset={reset("codeFont")}>
          <Select label="Code font" value={d().codeFont} options={options(CODE_FONTS, DEFAULT_DISPLAY.codeFont)} onChange={(codeFont) => set({ codeFont })} />
        </Row>
        <Row label="Font smoothing" description="Use thinner grayscale text smoothing instead of the system default." onReset={reset("smoothing")}>
          <Toggle label="Font smoothing" on={d().smoothing} onChange={(smoothing) => set({ smoothing })} />
        </Row>
      </Group>
    </>
  )
}

function TranslucencyGroup(): JSX.Element {
  const off = () => shown() === "light"
  return (
    <Group
      title="Translucency"
      description={
        off()
          ? "Light mode always uses an opaque window, so these are off. Your dark-mode values are kept."
          : "How much of the chat background shows through Kiko."
      }
    >
      <Row label="Sidebar opacity" description="Applies to the sidebar and the other glass panes." onReset={glass().opacity !== DEFAULT_GLASS.opacity ? () => setGlass({ opacity: DEFAULT_GLASS.opacity }) : undefined}>
        <Slider
          label="Sidebar opacity"
          value={percent(glass().opacity)}
          display={`${percent(glass().opacity)}%`}
          min={percent(SIDEBAR_OPACITY.min)}
          max={percent(SIDEBAR_OPACITY.max)}
          disabled={off()}
          onChange={(p) => setGlass({ opacity: p / 100 })}
        />
      </Row>
      <Row label="Blur radius" onReset={glass().blur !== DEFAULT_GLASS.blur ? () => setGlass({ blur: DEFAULT_GLASS.blur }) : undefined}>
        <Slider label="Blur radius" value={glass().blur} display={String(glass().blur)} min={BLUR_RADIUS.min} max={BLUR_RADIUS.max} disabled={off()} onChange={(blur) => setGlass({ blur })} />
      </Row>
      <Row label="Main pane glass" description="Extend the translucent treatment to the chat pane and the info pane." onReset={glass().body !== DEFAULT_GLASS.body ? () => setGlass({ body: DEFAULT_GLASS.body }) : undefined}>
        <Toggle label="Main pane glass" on={glass().body} disabled={off()} onChange={(body) => setGlass({ body })} />
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
      setError(cause instanceof Error ? cause.message : "That picture couldn't be used.")
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
    <Group title="Chat background" description="A picture behind your chats. It stays on this device." id="chat-background">
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
                <span class="text-xs">{busy() ? "Reading picture…" : "Choose an image"}</span>
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
              <span class="pointer-events-none absolute bottom-2 left-2 text-[11px] text-faint">Empty chat preview at {percent(bg()!.empty)}%</span>
            </div>
          </Show>
        </div>
        <input ref={input} type="file" accept="image/*" class="hidden" data-slot="background-file-input" onChange={(e) => pick(e.currentTarget.files?.[0])} />
        <Show when={bg()}>
          <div class="mt-3 flex items-center justify-end gap-2">
            <button type="button" class={buttonClass()} disabled={busy()} onClick={() => input?.click()}>
              {busy() ? "Reading…" : "Change"}
            </button>
            <button type="button" class={buttonClass("danger")} disabled={busy()} data-action="remove-background" onClick={() => void run(removeBackground)}>
              Remove
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
            <Row label="Background effect" description={EFFECT_DESCRIPTIONS[b().effect]}>
              <Segmented label="Background effect" value={b().effect} options={BACKGROUND_EFFECTS.map((e) => ({ value: e, label: EFFECT_LABELS[e] }))} onChange={(effect) => setBackground({ effect })} />
            </Row>
            <Row label="Show on">
              <Segmented
                label="Show background on"
                value={b().scope}
                options={[
                  { value: "empty", label: "Empty only" },
                  { value: "all", label: "All chats" },
                ]}
                onChange={(scope) => setBackground({ scope })}
              />
            </Row>
            <Row label="Empty chat visibility">
              <Slider
                label="Empty chat background visibility"
                value={percent(b().empty)}
                display={`${percent(b().empty)}%`}
                min={percent(VISIBILITY.min)}
                max={percent(VISIBILITY.max)}
                onChange={(p) => setBackground({ empty: p / 100 })}
              />
            </Row>
            <Row label="Chat visibility">
              <Slider
                label="Chat background visibility"
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
  updateLook({ mode: DEFAULT_LOOK.mode, light: null, dark: null, themes: [], wallpaper: null, tint: DEFAULT_LOOK.tint, accent: null, display: DEFAULT_DISPLAY })
  setGlass(DEFAULT_GLASS)
  if (background()) void removeBackground()
}

export default function Appearance(): JSX.Element {
  return (
    <div class="flex flex-col gap-8" data-component="appearance" data-appearance-now={shown()}>
      <ColorGroups />
      <InterfaceGroups />
      <TranslucencyGroup />
      <BackgroundGroup />
      <div class="flex justify-end">
        <button type="button" class={buttonClass()} data-action="restore-appearance" onClick={restoreDefaults}>
          Restore defaults
        </button>
      </div>
    </div>
  )
}
