import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { appearanceOf } from "@kiko/theme/apply"
import { BASE_SIZE, CHAT_WIDTHS, CONTRAST, DEFAULT_DISPLAY, type ChatWidth, type Display } from "@kiko/theme/display"
import { themeFor } from "@kiko/theme/imported"
import { DEFAULT_LOOK, type Mode } from "@kiko/theme/look"
import { THEME_IDS, THEMES, type Palette, type ThemeAppearance } from "@kiko/theme/palette"
import { buttonClass, Group, Row, Segmented, Slider, Toggle } from "../settings/kit"
import { Select } from "../settings/select"
import { look, previewLook, updateLook } from "./live"
import { choose, chooseBuiltin, DEFAULT, remove, themes } from "./live"
import { ThemeBrowser } from "./open-vsx-themes"

const shown = () => appearanceOf(look().mode)

function Preview(props: { palette: Palette; accent: string }) {
  const p = () => props.palette
  const tint = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, transparent)`
  return (
    <div class="flex h-20 w-full overflow-hidden" style={{ background: p().canvas }} aria-hidden="true">
      <div class="flex w-[28%] flex-col gap-1.5 p-2" style={{ background: p().sidebar }}>
        <span class="h-1.5 w-3/4 rounded-full" style={{ background: tint(p().text, 30) }} />
        <span class="h-1.5 w-1/2 rounded-full" style={{ background: tint(p().text, 16) }} />
        <span class="h-1.5 w-2/3 rounded-full" style={{ background: tint(p().text, 16) }} />
      </div>
      <div class="flex flex-1 flex-col justify-end gap-1.5 p-2">
        <span class="h-3.5 w-3/5 rounded-md" style={{ background: tint(p().text, 9) }} />
        <span class="h-3.5 w-2/5 self-end rounded-md" style={{ background: tint(props.accent, 40) }} />
      </div>
    </div>
  )
}

function ThemeCard(props: {
  name: string
  palette: Palette
  accent: string
  selected: boolean
  onPick: () => void
  onRemove?: () => void
}) {
  return (
    <div class="group/theme relative">
      <button
        type="button"
        role="radio"
        aria-checked={props.selected}
        class="flex w-full flex-col overflow-hidden rounded-lg text-left hover:brightness-110 focus-visible:brightness-125"
        data-theme-card={props.name}
        onClick={props.onPick}
      >
        <Preview palette={props.palette} accent={props.accent} />
        <span
          class="truncate px-2.5 py-1.5 text-sm"
          style={{ background: props.palette.canvas, color: props.palette.text }}
        >
          {props.name}
          {props.selected ? " ✓" : ""}
        </span>
      </button>
      <Show when={props.onRemove}>
        <button
          type="button"
          class="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-md bg-popover text-muted-foreground opacity-0 shadow-menu group-hover/theme:opacity-100 hover:text-error focus-visible:opacity-100"
          aria-label={`Remove ${props.name}`}
          title="Remove"
          onClick={props.onRemove}
        >
          <svg
            class="size-3"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </Show>
    </div>
  )
}

function Gallery(props: { appearance: ThemeAppearance; onMore: () => void }) {
  const active = () => themeFor(themes(), props.appearance)?.id ?? DEFAULT
  const installed = () => themes().themes.filter((t) => t.appearance === props.appearance)
  let more: HTMLButtonElement | undefined
  return (
    <section class="flex flex-col gap-2" data-component="theme-gallery" data-appearance={props.appearance}>
      <h2 class="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
        {props.appearance === "dark" ? "Dark" : "Light"}
        <Show when={shown() === props.appearance}>
          <span class="text-xs font-normal text-secondary-label">Showing now</span>
        </Show>
      </h2>
      <div
        role="radiogroup"
        aria-label={props.appearance === "dark" ? "Dark theme" : "Light theme"}
        class="grid grid-cols-2 gap-2 @min-[560px]/settings:grid-cols-4"
      >
        <For each={installed()}>
          {(theme) => (
            <ThemeCard
              name={theme.name}
              palette={theme.palette}
              accent={theme.accent}
              selected={active() === theme.id}
              onPick={() => {
                choose(props.appearance, theme.id)
                updateLook({ mode: props.appearance })
              }}
              onRemove={() => {
                remove(theme)
                more?.focus()
              }}
            />
          )}
        </For>
        <button
          ref={more}
          type="button"
          class="flex min-h-[110px] flex-col items-center justify-center gap-1 rounded-lg bg-control text-sm text-muted-foreground hover:bg-control-strong hover:text-foreground"
          data-action="browse-themes"
          onClick={props.onMore}
        >
          <svg
            class="size-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
          Get more
        </button>
      </div>
    </section>
  )
}

function FontField(props: { label: string; placeholder: string; value: string; onInput: (value: string) => void }) {
  const [draft, setDraft] = createSignal(props.value)
  const [editing, setEditing] = createSignal(false)
  createEffect(() => {
    if (!editing()) setDraft(props.value)
  })
  return (
    <input
      class="kit-field w-44"
      aria-label={props.label}
      placeholder={props.placeholder}
      value={draft()}
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      onInput={(event) => {
        const value = event.currentTarget.value
        setDraft(value)
        props.onInput(value.trim())
      }}
    />
  )
}

export default function Appearance(): JSX.Element {
  const [browsing, setBrowsing] = createSignal(false)
  const d = () => look().display
  const set = (patch: Partial<Display>) => updateLook({ display: { ...d(), ...patch } })
  let stopPreview: (() => void) | undefined
  const release = () => {
    stopPreview?.()
    stopPreview = undefined
  }
  const previewContrast = (contrast: number) => {
    release()
    stopPreview = previewLook({ ...look(), display: { ...d(), contrast } })
  }
  onCleanup(release)
  const reset = <K extends keyof Display>(key: K) =>
    d()[key] !== DEFAULT_DISPLAY[key] ? () => set({ [key]: DEFAULT_DISPLAY[key] } as Partial<Display>) : undefined
  const sizes = Array.from({ length: BASE_SIZE.max - BASE_SIZE.min + 1 }, (_, i) => BASE_SIZE.min + i)
  return (
    <div class="flex flex-col gap-8" data-component="appearance" data-appearance-now={shown()}>
      <div class="flex flex-col gap-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <Segmented<Mode>
            label="Mode"
            value={look().mode}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(mode) => updateLook({ mode })}
          />
        </div>
        <div
          role="radiogroup"
          aria-label="Built-in themes"
          class="grid grid-cols-2 gap-2 @min-[560px]/settings:grid-cols-4"
        >
          <For each={THEME_IDS}>
            {(id) => (
              <ThemeCard
                name={THEMES[id].label}
                palette={THEMES[id].palette}
                accent={THEMES[id].accent}
                selected={
                  !themeFor(themes(), id === "snow" ? "light" : "dark") &&
                  shown() === (id === "snow" ? "light" : "dark") &&
                  (id === "snow" || look().darkTheme === id)
                }
                onPick={() => chooseBuiltin(id)}
              />
            )}
          </For>
        </div>
        <Gallery appearance="dark" onMore={() => setBrowsing(true)} />
        <Gallery appearance="light" onMore={() => setBrowsing(true)} />
      </div>

      <Group title="Text and layout">
        <Row label="Text size" onReset={reset("baseSize")}>
          <Select
            label="Text size"
            value={d().baseSize}
            options={sizes.map((px) => ({ value: px, label: `${px} px` }))}
            onChange={(baseSize) => set({ baseSize })}
          />
        </Row>
        <Row label="Chat width" onReset={reset("chatWidth")}>
          <Select
            label="Chat width"
            value={d().chatWidth}
            options={(Object.keys(CHAT_WIDTHS) as ChatWidth[]).map((value) => ({
              value,
              label: CHAT_WIDTHS[value].label,
            }))}
            onChange={(chatWidth) => set({ chatWidth })}
          />
        </Row>
        <Row label="Contrast" description="Borders, lines, and fills." onReset={reset("contrast")}>
          <div class="contents" onPointerCancel={release}>
            <Slider
              label="Contrast"
              value={d().contrast}
              display={`${d().contrast}%`}
              min={CONTRAST.min}
              max={CONTRAST.max}
              step={CONTRAST.step}
              onInput={(contrast) => previewContrast(contrast)}
              onChange={(contrast) => {
                set({ contrast })
                release()
              }}
            />
          </div>
        </Row>
        <Row
          label="Interface font"
          description="Any font on this device. Empty uses the system font."
          onReset={reset("interfaceFont")}
        >
          <FontField
            label="Interface font"
            placeholder="System"
            value={d().interfaceFont}
            onInput={(interfaceFont) => set({ interfaceFont })}
          />
        </Row>
        <Row label="Code font" onReset={reset("codeFont")}>
          <FontField
            label="Code font"
            placeholder="System mono"
            value={d().codeFont}
            onInput={(codeFont) => set({ codeFont })}
          />
        </Row>
        <Row label="Thin text smoothing" onReset={reset("smoothing")}>
          <Toggle label="Thin text smoothing" on={d().smoothing} onChange={(smoothing) => set({ smoothing })} />
        </Row>
      </Group>

      <div class="flex justify-end">
        <button
          type="button"
          class={buttonClass("ghost")}
          data-action="restore-appearance"
          onClick={() => {
            chooseBuiltin(DEFAULT_LOOK.darkTheme)
            updateLook({ display: DEFAULT_DISPLAY })
          }}
        >
          Restore defaults
        </button>
      </div>
      <ThemeBrowser open={browsing()} onClose={() => setBrowsing(false)} />
    </div>
  )
}
