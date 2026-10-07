// Settings, appearance: the color scheme and the theme library. Ported from t3code (MIT),
// apps/web/src/components/settings/ThemeSettings.tsx, in kiko's own controls.
// DEVIATION: no theme editor and no fonts. The library holds the stock palette, t3code's
// built-in themes, and the themes this browser imported.
import { HugeIcon } from "@kiko/ui/huge-icon"
import { MoonIcon, PlusIcon, ShareIcon, SunIcon, TrashIcon } from "@kiko/ui/icons"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { For, Show, Suspense, createSignal, lazy, type JSX } from "solid-js"
import { appearanceOf } from "./apply"
import { button, iconButton } from "./controls"
import { BUILT_IN_THEMES } from "./builtins"
import { chooseTheme, customThemes, look, removeThemes, setHalf, updateLook } from "./live"
import { findTheme, MODES, type Mode } from "./look"
import { serializeThemeFile, themeModes, type ThemeAppearance, type ThemeDefinition } from "./palette"
import { DEFAULT_CARD, ThemeOrb, ThemeWireframe, previewOf, themeCard, type ThemeCard } from "./theme-preview"

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

const MODE_LABEL: Record<Mode, string> = { system: "system", light: "light", dark: "dark" }

function cardFor(id: string | null): ThemeCard {
  const theme = findTheme(id, look(), customThemes())
  return theme ? themeCard(theme) : DEFAULT_CARD
}

function ModeTiles(): JSX.Element {
  const colors = (mode: ThemeAppearance) => previewOf(cardFor(look()[mode]), mode)
  return (
    <div aria-label="appearance mode" role="radiogroup" class="grid w-full grid-cols-3 gap-3">
      <For each={MODES}>
        {(mode) => (
          <button
            type="button"
            role="radio"
            aria-label={mode === "system" ? "follow the system appearance" : `use ${mode} mode`}
            aria-checked={look().mode === mode}
            data-mode={mode}
            class="group flex flex-col items-stretch gap-1.5 rounded-xl bg-[var(--card)] p-2 outline-none hover:bg-[var(--hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:shadow-[inset_0_0_0_1.5px_var(--accent)]"
            onClick={() => updateLook({ mode })}
          >
            <ThemeWireframe
              panes={
                mode === "system"
                  ? [
                      { clip: "left", colors: colors("light") },
                      { clip: "right", colors: colors("dark") },
                    ]
                  : [{ colors: colors(mode) }]
              }
            />
            <span class="text-center text-xs font-medium text-muted group-aria-checked:text-text">{MODE_LABEL[mode]}</span>
          </button>
        )}
      </For>
    </div>
  )
}

function ThemeLibraryCard(props: { card: ThemeCard; subtitle?: string; onExport?: () => void; onRemove?: () => void }): JSX.Element {
  const owns = (mode: ThemeAppearance) => look()[mode] === props.card.id
  const active = () => props.card.previews.every((p) => owns(p.mode))
  return (
    <div
      data-theme-card={props.card.id ?? "default"}
      aria-current={active() ? "true" : undefined}
      class="cursor-default overflow-hidden rounded-xl bg-[var(--card)] hover:bg-[var(--hover-bg)] aria-[current]:shadow-[inset_0_0_0_1.5px_var(--accent)]"
      onClick={() => chooseTheme(props.card.id)}
    >
      <div class="flex min-h-16 items-center justify-center gap-2.5 px-3 pt-3">
        <For each={props.card.previews}>
          {(preview) => (
            <button
              type="button"
              title={preview.mode === "light" ? "use for light mode" : "use for dark mode"}
              aria-label={`use ${props.card.label} for ${preview.mode} mode`}
              aria-pressed={owns(preview.mode)}
              class="relative flex size-[68px] shrink-0 items-center justify-center rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              onClick={(event) => {
                event.stopPropagation()
                setHalf(preview.mode, props.card.id)
              }}
            >
              <ThemeOrb colors={preview.colors} mode={preview.mode} />
              <Show when={owns(preview.mode)}>
                <span aria-hidden="true" class="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_var(--accent)]" />
                <span aria-hidden="true" class="pointer-events-none absolute right-0.5 bottom-0.5 grid size-5 place-items-center rounded-full bg-[var(--bg)] text-text shadow-sm">
                  <HugeIcon icon={preview.mode === "light" ? SunIcon : MoonIcon} size={12} />
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <div class="flex items-center gap-1 px-3 pt-2 pb-3">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-text">{props.card.label}</p>
          <Show when={props.subtitle}>
            <p class="truncate text-xs text-muted">{props.subtitle}</p>
          </Show>
        </div>
        <Show when={props.onExport}>
          <button
            type="button"
            class={iconButton}
            title="export theme file"
            aria-label={`export ${props.card.label}`}
            onClick={(event) => {
              event.stopPropagation()
              props.onExport!()
            }}
          >
            <HugeIcon icon={ShareIcon} size={14} />
          </button>
        </Show>
        <Show when={props.onRemove}>
          <button
            type="button"
            class={`${iconButton} hover:text-[var(--danger)]`}
            title="remove theme"
            aria-label={`remove ${props.card.label}`}
            data-action="remove-theme"
            onClick={(event) => {
              event.stopPropagation()
              props.onRemove!()
            }}
          >
            <HugeIcon icon={TrashIcon} size={14} />
          </button>
        </Show>
      </div>
    </div>
  )
}

function ThemeLibrary(): JSX.Element {
  const [importOpen, setImportOpen] = createSignal(false)
  const remove = (theme: ThemeDefinition) => {
    if (!removeThemes([theme.id])) return void showToastV2({ title: "couldn't remove the theme. try again", variant: "error" })
    showToastV2({ title: `${theme.label.toLowerCase()} removed`, description: "import its json file to bring it back" })
  }
  const grid = { "grid-template-columns": "repeat(auto-fill, minmax(min(100%, 14rem), 1fr))" }
  return (
    <div class="flex flex-col gap-3">
      <h3 class="text-sm text-text">color scheme</h3>
      <ModeTiles />
      <div class="flex min-h-8 flex-wrap items-center justify-between gap-3 pt-3">
        <h3 class="text-sm text-text">theme</h3>
        <button type="button" class={button} data-action="add-theme" onClick={() => setImportOpen(true)}>
          <HugeIcon icon={PlusIcon} size={14} />
          add theme
        </button>
      </div>
      <div class="grid w-full gap-2" style={grid} data-component="theme-library">
        <ThemeLibraryCard card={DEFAULT_CARD} />
        <For each={BUILT_IN_THEMES}>{(theme) => <ThemeLibraryCard card={themeCard(theme)} />}</For>
        <For each={customThemes()}>
          {(theme) => (
            <ThemeLibraryCard
              card={themeCard(theme)}
              subtitle={theme.collection && theme.collection.label !== theme.label ? theme.collection.label.toLowerCase() : undefined}
              onExport={() => download(`${theme.id}.json`, serializeThemeFile(theme))}
              onRemove={() => remove(theme)}
            />
          )}
        </For>
      </div>
      <Show when={importOpen()}>
        <Suspense>
          <ThemeImportDialog
            onClose={() => setImportOpen(false)}
            onImported={(themes, updated) => {
              const verb = updated ? "updated" : "added"
              const first = themes[0]
              if (themes.length === 1 && first) {
                chooseTheme(first.id)
                const modes = themeModes(first)
                showToastV2({
                  title: `${first.label.toLowerCase()} ${verb}`,
                  description: modes.length === 1 ? `it's now your ${modes[0]} theme` : "it's now in use",
                  variant: "success",
                })
              } else {
                showToastV2({ title: `${themes.length} themes ${verb}`, description: themes.map((t) => t.label.toLowerCase()).join(", "), variant: "success" })
              }
            }}
          />
        </Suspense>
      </Show>
    </div>
  )
}

export default function Appearance(): JSX.Element {
  return (
    <div class="flex flex-col gap-8" data-component="appearance" data-appearance-now={appearanceOf(look().mode)}>
      <ThemeLibrary />
    </div>
  )
}
