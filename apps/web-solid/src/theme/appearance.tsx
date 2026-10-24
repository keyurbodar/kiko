import { Segmented } from "@kiko/ui/v2/segmented"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, CloseIcon, PlusIcon } from "@kiko/ui/icons"
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { appearanceOf } from "@kiko/theme/apply"
import { BASE_SIZE, CHAT_WIDTHS, CONTRAST, DEFAULT_DISPLAY, type ChatWidth, type Display } from "@kiko/theme/display"
import { themeFor } from "@kiko/theme/imported"
import { DEFAULT_LOOK, type Mode } from "@kiko/theme/look"
import { THEME_IDS, THEMES, type Palette, type ThemeAppearance } from "@kiko/theme/palette"
import { buttonClass, Group, Row, Slider, Toggle } from "../settings/kit"
import { Select } from "../settings/select"
import { look, previewLook, updateLook } from "./live"
import { choose, chooseBuiltin, DEFAULT, remove, themes } from "./live"
import { isFontFamilyAvailable } from "./fonts"
import { ThemeBrowser } from "./open-vsx-themes"

const shown = () => appearanceOf(look().mode)

function Preview(props: { palette: Palette; light: boolean }) {
  const p = () => props.palette
  const solid = (pct: number) => `color-mix(in oklab, ${p().text} ${pct}%, ${p().canvas})`
  const raise = () => solid(props.light ? 2.4 : 4.6)
  const me = () => solid(props.light ? 5.5 : 9.6)
  const tint = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, transparent)`
  return (
    <div
      class="flex h-[104px] w-full overflow-hidden rounded-[14px]"
      style={{ background: p().canvas }}
      aria-hidden="true"
    >
      <div class="flex w-[34%] flex-col gap-[5px] p-2.5" style={{ background: p().sidebar }}>
        <span class="h-[5px] w-3/5 rounded-[3px]" style={{ background: tint(p().text, 60) }} />
        <span class="h-[7px] w-[85%] rounded-[3px]" style={{ background: tint(p().text, 35) }} />
        <span class="h-[5px] w-[70%] rounded-[3px]" style={{ background: tint(p().muted, 40) }} />
      </div>
      <div class="flex flex-1 flex-col items-end gap-1.5 p-3.5">
        <span class="h-[18px] w-1/2 rounded-[9px]" style={{ background: me() }} />
        <span class="h-[18px] w-[70%] self-start rounded-[9px]" style={{ background: raise() }} />
      </div>
    </div>
  )
}

function ThemeCard(props: {
  name: string
  palette: Palette
  light: boolean
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
        class="flex w-full flex-col gap-2 text-left outline-none transition-transform duration-[var(--dur-hover)] ease-[var(--ease-kiko)] active:scale-[0.98]"
        data-theme-card={props.name}
        onClick={props.onPick}
      >
        <span
          class="relative block rounded-[14px] transition-shadow duration-[var(--dur-hover)] hover:shadow-[0_0_0_1px_var(--line2)]"
          classList={{ "shadow-[0_0_0_2px_var(--fg3)]": props.selected }}
        >
          <Preview palette={props.palette} light={props.light} />
          <Show when={props.selected}>
            <span class="absolute top-2 right-2 grid size-[18px] place-items-center rounded-full bg-fg text-bg">
              <RemixIcon icon={CheckIcon} size={11} />
            </span>
          </Show>
        </span>
        <span
          class="truncate text-[13.5px]"
          classList={{ "font-semibold text-fg": props.selected, "text-fg2": !props.selected }}
        >
          {props.name}
        </span>
      </button>
      <Show when={props.onRemove}>
        <button
          type="button"
          class="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-control bg-raise text-fg2 opacity-0 shadow-menu group-hover/theme:opacity-100 hover:text-bad focus-visible:opacity-100"
          aria-label={`Remove ${props.name}`}
          title="Remove"
          onClick={props.onRemove}
        >
          <RemixIcon icon={CloseIcon} size={12} />
        </button>
      </Show>
    </div>
  )
}

function Gallery(props: { appearance: ThemeAppearance }) {
  const active = () => themeFor(themes(), props.appearance)?.id ?? DEFAULT
  const installed = () => themes().themes.filter((t) => t.appearance === props.appearance)
  return (
    <Show when={installed().length}>
      <section class="flex flex-col gap-2" data-component="theme-gallery" data-appearance={props.appearance}>
        <h2 class="flex items-center gap-2 px-1 type-label text-fg3">
          {props.appearance === "dark" ? "Imported dark" : "Imported light"}
          <Show when={shown() === props.appearance}>
            <span class="text-hint font-normal text-fg4">Showing now</span>
          </Show>
        </h2>
        <div
          role="radiogroup"
          aria-label={props.appearance === "dark" ? "Dark theme" : "Light theme"}
          class="grid grid-cols-2 gap-x-3 gap-y-5 @min-[560px]/settings:grid-cols-3"
        >
          <For each={installed()}>
            {(theme) => (
              <ThemeCard
                name={theme.name}
                palette={theme.palette}
                light={props.appearance === "light"}
                selected={active() === theme.id}
                onPick={() => {
                  choose(props.appearance, theme.id)
                  updateLook({ mode: props.appearance })
                }}
                onRemove={() => remove(theme)}
              />
            )}
          </For>
        </div>
      </section>
    </Show>
  )
}

const COMMIT_PAUSE_MS = 400

function FontField(props: { label: string; placeholder: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = createSignal(props.value)
  const [settled, setSettled] = createSignal(true)
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  createEffect(
    on(
      () => props.value,
      (value) => {
        if (value === draft().trim()) return
        cancel()
        setDraft(value)
        setSettled(true)
      },
    ),
  )
  onCleanup(cancel)
  const commit = (next: string) => {
    setSettled(true)
    const name = next.trim()
    if (name === "" || isFontFamilyAvailable(name)) props.onCommit(name)
  }
  const flush = () => {
    if (timer === undefined) return
    cancel()
    commit(draft())
  }
  const invalid = () => settled() && draft().trim() !== "" && draft().trim() !== props.value
  return (
    <input
      class="kit-field w-44"
      aria-label={props.label}
      aria-invalid={invalid() || undefined}
      autocapitalize="off"
      autocomplete="off"
      spellcheck={false}
      placeholder={props.placeholder}
      value={draft()}
      onBlur={flush}
      onInput={(event) => {
        const value = event.currentTarget.value
        setDraft(value)
        setSettled(false)
        cancel()
        timer = setTimeout(() => {
          timer = undefined
          commit(value)
        }, COMMIT_PAUSE_MS)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") flush()
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        cancel()
        setDraft(props.value)
        setSettled(true)
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
          class="grid grid-cols-2 gap-x-3 gap-y-5 @min-[560px]/settings:grid-cols-3"
        >
          <For each={THEME_IDS}>
            {(id) => (
              <ThemeCard
                name={THEMES[id].label}
                palette={THEMES[id].palette}
                light={id === "snow"}
                selected={
                  !themeFor(themes(), id === "snow" ? "light" : "dark") &&
                  shown() === (id === "snow" ? "light" : "dark") &&
                  (id === "snow" || look().darkTheme === id)
                }
                onPick={() => chooseBuiltin(id)}
              />
            )}
          </For>
          <button
            type="button"
            class="flex h-[104px] flex-col items-center justify-center gap-1 rounded-[14px] bg-panel text-[13.5px] text-fg2 transition-colors duration-[var(--dur-hover)] hover:bg-hover hover:text-fg active:scale-[0.98]"
            data-action="browse-themes"
            onClick={() => setBrowsing(true)}
          >
            <RemixIcon icon={PlusIcon} size={16} />
            Get more
          </button>
        </div>
        <Gallery appearance="dark" />
        <Gallery appearance="light" />
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
            onCommit={(interfaceFont) => set({ interfaceFont })}
          />
        </Row>
        <Row label="Code font" onReset={reset("codeFont")}>
          <FontField
            label="Code font"
            placeholder="System mono"
            value={d().codeFont}
            onCommit={(codeFont) => set({ codeFont })}
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
