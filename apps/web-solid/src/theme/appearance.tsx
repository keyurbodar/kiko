import { Segmented } from "@kiko/ui/v2/segmented"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, CloseIcon, PlusIcon } from "@kiko/ui/icons"
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { appearanceOf } from "@kiko/theme/apply"
import { BASE_SIZE, CHAT_WIDTHS, CONTRAST, DEFAULT_DISPLAY, type ChatWidth, type Display } from "@kiko/theme/display"
import { DEFAULT_LOOK, type Mode } from "@kiko/theme/look"
import { DARK_THEME_IDS, THEMES, type Palette, type ThemeAppearance } from "@kiko/theme/palette"
import { buttonClass, Group, Row, Slider, Toggle } from "../settings/kit"
import { Select } from "../settings/select"
import { look, previewLook, updateLook } from "./live"
import { chooseBuiltin, pickTheme, remove, themes } from "./live"
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
      class="flex h-[104px] w-full overflow-hidden rounded-pop"
      style={{ background: p().canvas }}
      aria-hidden="true"
    >
      <div class="flex w-[34%] flex-col gap-[5px] p-2.5" style={{ background: p().sidebar }}>
        <span class="h-[5px] w-3/5 rounded-[3px]" style={{ background: tint(p().text, 60) }} />
        <span class="h-[7px] w-[85%] rounded-[3px]" style={{ background: tint(p().text, 35) }} />
        <span class="h-[5px] w-[70%] rounded-[3px]" style={{ background: tint(p().muted, 40) }} />
      </div>
      <div class="flex flex-1 flex-col items-end gap-1.5 p-3.5">
        <span class="h-[18px] w-1/2 rounded-control" style={{ background: me() }} />
        <span class="h-[18px] w-[70%] self-start rounded-control" style={{ background: raise() }} />
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
          class="relative block rounded-pop transition-shadow duration-(--dur-pop) ease-kiko"
          classList={{
            "shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--fg3)]": props.selected,
            "hover:shadow-[0_0_0_1px_var(--line2)]": !props.selected,
          }}
        >
          <Preview palette={props.palette} light={props.light} />
          <Show when={props.selected}>
            <span
              class="absolute top-2 right-2 grid size-[18px] place-items-center rounded-full"
              style={{ background: props.palette.text, color: props.palette.canvas }}
            >
              <RemixIcon icon={CheckIcon} size={12} />
            </span>
          </Show>
        </span>
        <span
          class="truncate type-ui"
          classList={{ "font-semibold text-fg": props.selected, "text-fg2": !props.selected }}
        >
          {props.name}
        </span>
      </button>
      <Show when={props.onRemove}>
        <button
          type="button"
          class="absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-control bg-raise text-fg2 opacity-0 shadow-menu group-hover/theme:opacity-100 hover:text-bad focus-visible:opacity-100"
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

type Card = { id: string; name: string; palette: Palette; removable?: () => void }

const BUILTIN: Record<ThemeAppearance, readonly string[]> = { dark: DARK_THEME_IDS, light: ["snow"] }

function cardsFor(appearance: ThemeAppearance): Card[] {
  const builtin = BUILTIN[appearance].map((id) => {
    const theme = THEMES[id as keyof typeof THEMES]
    return { id, name: theme.label, palette: theme.palette }
  })
  const imported = themes()
    .themes.filter((t) => t.appearance === appearance)
    .map((t) => ({ id: t.id, name: t.name, palette: t.palette, removable: () => remove(t) }))
  return [...builtin, ...imported]
}

function pickedFor(appearance: ThemeAppearance): string {
  const imported = themes().active[appearance]
  if (imported && themes().themes.some((t) => t.id === imported)) return imported
  return appearance === "dark" ? look().darkTheme : "snow"
}

const gridClass = "grid grid-cols-2 gap-x-3 gap-y-5 @min-[560px]/settings:grid-cols-3"

function ThemeGrid(props: { appearance: ThemeAppearance; more?: () => void }) {
  return (
    <div class={gridClass} data-component="theme-gallery" data-appearance={props.appearance}>
      <div role="radiogroup" aria-label={props.appearance === "dark" ? "Dark theme" : "Light theme"} class="contents">
        <For each={cardsFor(props.appearance)}>
          {(card) => (
            <ThemeCard
              name={card.name}
              palette={card.palette}
              light={props.appearance === "light"}
              selected={pickedFor(props.appearance) === card.id}
              onPick={() => pickTheme(props.appearance, card.id)}
              onRemove={card.removable}
            />
          )}
        </For>
      </div>
      <Show when={props.more}>
        {(more) => (
          <button
            type="button"
            class="flex h-[104px] cursor-pointer flex-col items-center justify-center gap-1 rounded-pop bg-panel type-ui text-fg2 transition-[background-color,color,transform] duration-(--dur-hover) ease-kiko hover:bg-hover hover:text-fg active:scale-[0.98]"
            data-action="browse-themes"
            onClick={() => more()()}
          >
            <RemixIcon icon={PlusIcon} size={16} />
            More themes
          </button>
        )}
      </Show>
    </div>
  )
}

function ThemeSection(props: { onMore: () => void }) {
  const mode = () => look().mode
  return (
    <section class="flex flex-col gap-3" data-component="theme-picker">
      <div class="flex flex-wrap items-center justify-between gap-3 px-1">
        <h2 class="flex h-section-label items-center type-label text-fg3">Theme</h2>
        <Segmented<Mode>
          label="Mode"
          value={mode()}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(next) => updateLook({ mode: next })}
        />
      </div>
      <Show
        when={mode() === "system"}
        fallback={<ThemeGrid appearance={mode() === "light" ? "light" : "dark"} more={props.onMore} />}
      >
        <div class="flex flex-col gap-2">
          <h3 class="flex items-center gap-2 px-1 type-label text-fg3">
            Light
            <Show when={shown() === "light"}>
              <span class="type-hint text-fg4">Showing now</span>
            </Show>
          </h3>
          <ThemeGrid appearance="light" />
        </div>
        <div class="flex flex-col gap-2">
          <h3 class="flex items-center gap-2 px-1 type-label text-fg3">
            Dark
            <Show when={shown() === "dark"}>
              <span class="type-hint text-fg4">Showing now</span>
            </Show>
          </h3>
          <ThemeGrid appearance="dark" more={props.onMore} />
        </div>
      </Show>
    </section>
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
      <ThemeSection onMore={() => setBrowsing(true)} />

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
