import { createSignal, For, Show } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { type Glyph, MonitorIcon, MoonIcon, SunIcon } from "@kiko/ui/icons"
import { appearanceOf } from "./apply"
import type { Look, Mode, Style } from "./look"
import { FROST_WHERE, MAX_FROST, MIN_GLASS, MODES, presetOf, STYLES, styleOf, withStyle } from "./look"
import { SWATCHES, swatchColor } from "./presets"
import { prepareWallpaper, themeFrom } from "./wallpaper"
import { saveSharp } from "./wallpaper-store"

/*
 * The look controls: a style, an appearance, a wallpaper, a colour, and how much that colour
 * tints the greys, or with a wallpaper its frost, dim and grain. Settings and the first-run screen both use it. A click saves at once: the look is
 * instant, so there is nothing to confirm.
 */

const MODE_ICON: Record<Mode, Glyph> = { system: MonitorIcon, light: SunIcon, dark: MoonIcon }

/* Each card draws a small window in its own colours, so a style can be judged before it is picked. */
const CARD: Record<Style, { label: string; side: string; panel: string; bubble: string; line: string; scene?: string }> = {
  frost: {
    label: "frost",
    scene: "radial-gradient(60% 60% at 20% 20%, oklch(0.42 0.03 var(--hue)), transparent 70%), radial-gradient(50% 60% at 90% 90%, oklch(0.3 0.02 var(--hue)), transparent 70%), oklch(0.25 0.015 var(--hue))",
    side: "oklch(0.2 0.01 var(--hue) / 0.45)",
    panel: "oklch(0.2 0.01 var(--hue) / 0.6)",
    bubble: "oklch(0.3 0.006 var(--hue))",
    line: "oklch(1 0 0 / 0.14)",
  },
  graphite: { label: "graphite", side: "oklch(0.175 0 0)", panel: "oklch(0.205 0 0)", bubble: "oklch(0.27 0 0)", line: "oklch(1 0 0 / 0.1)" },
  porcelain: { label: "porcelain", side: "oklch(0.962 0.003 85)", panel: "oklch(0.99 0.002 85)", bubble: "oklch(0.93 0.004 85)", line: "oklch(0 0 0 / 0.08)" },
}

function StyleCard(props: { style: Style; on: boolean; onPick: () => void }) {
  const c = () => CARD[props.style]
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.on}
      data-style={props.style}
      class="group flex flex-col gap-2 rounded-xl p-1.5 text-left outline-none hover:bg-[var(--hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:bg-[var(--selected-bg)]"
      onClick={() => props.onPick()}
    >
      <span
        class="relative flex h-[76px] w-full overflow-hidden rounded-lg"
        style={{ background: c().scene ?? c().panel, "box-shadow": `inset 0 0 0 1px ${c().line}` }}
        aria-hidden="true"
      >
        <span class="flex w-[32%] flex-col gap-1 p-1.5" style={{ background: c().side }}>
          <span class="h-1.5 w-3/4 rounded-full" style={{ background: c().line }} />
          <span class="h-1.5 w-full rounded-full" style={{ background: c().line }} />
          <span class="h-1.5 w-2/3 rounded-full" style={{ background: c().line }} />
        </span>
        <span class="flex flex-1 flex-col justify-end gap-1 p-1.5" style={{ background: c().scene ? c().panel : "transparent" }}>
          <span class="h-2.5 w-3/5 self-end rounded-full bg-[var(--user-bubble)]" />
          <span class="h-2.5 w-1/2 rounded-full" style={{ background: c().bubble }} />
        </span>
      </span>
      <span class="px-1 text-[13px] text-muted group-aria-checked:text-text">{c().label}</span>
    </button>
  )
}

/** A labelled range. A share (0 to 1) shows as a percent; `unit` shows the raw value instead. */
function Slider(props: { label: string; min?: number; max?: number; value: number; unit?: string; onInput: (v: number) => void }) {
  const share = () => props.unit === undefined
  const shown = () => (share() ? Math.round(props.value * 100) : props.value)
  return (
    <label class="flex items-center gap-3 text-[13px] text-muted" data-component={props.label}>
      <span class="w-10 shrink-0">{props.label}</span>
      <input
        type="range"
        min={share() ? (props.min ?? 0) * 100 : (props.min ?? 0)}
        max={share() ? (props.max ?? 1) * 100 : (props.max ?? 100)}
        step="1"
        class="h-1 min-w-0 flex-1 accent-[var(--accent-fill)]"
        aria-label={props.label}
        value={shown()}
        onInput={(e) => props.onInput(Number(e.currentTarget.value) / (share() ? 100 : 1))}
      />
      <span class="w-9 shrink-0 text-right text-[11px] tabular-nums text-faint">
        {shown()}
        {share() ? "%" : props.unit}
      </span>
    </label>
  )
}

/*
 * The wallpaper's own settings, all live: how frosted it is and where, how dark the overlay is,
 * and how much grain. Each one is a CSS variable, so nothing is re-read or re-encoded.
 */
function WallpaperControls(props: { look: Look; onChange: (next: Look) => void }) {
  const set = (patch: Partial<Look>) => props.onChange({ ...props.look, ...patch })
  return (
    <div class="flex flex-col gap-3" data-component="wallpaper-controls">
      <Slider label="frost" max={MAX_FROST} unit="px" value={props.look.frost} onInput={(frost) => set({ frost })} />
      <div class="flex items-center gap-3 text-[13px] text-muted" role="radiogroup" aria-label="where the frost is">
        <span class="w-10 shrink-0">where</span>
        <For each={FROST_WHERE}>
          {(where) => (
            <button
              type="button"
              role="radio"
              aria-checked={props.look.frostWhere === where}
              data-frost-where={where}
              class="flex h-7 items-center rounded-lg px-2.5 text-[13px] text-muted outline-none hover:bg-[var(--hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:bg-[var(--selected-bg)] aria-checked:text-text"
              onClick={() => set({ frostWhere: where })}
            >
              {where === "everywhere" ? "everywhere" : "toward bottom"}
            </button>
          )}
        </For>
      </div>
      <Slider label="dim" min={MIN_GLASS} value={props.look.glass} onInput={(glass) => set({ glass })} />
      <Slider label="grain" value={props.look.grain} onInput={(grain) => set({ grain })} />
    </div>
  )
}

/*
 * Choosing a picture keeps a sharp copy on this device, shrinks a blurred one into the look,
 * reads its palette, and saves a look with the picture, frost, and a theme generated from the
 * palette, all at once.
 */
function WallpaperRow(props: { look: Look; onChange: (next: Look) => void }) {
  let input: HTMLInputElement | undefined
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError("")
    try {
      const { wallpaper, sharp, palette } = await prepareWallpaper(file)
      // Stored first, so the look that follows finds its sharp copy at once.
      await saveSharp(wallpaper, sharp)
      props.onChange({ ...props.look, wallpaper, material: "frost", theme: { custom: themeFrom(palette) } })
    } catch {
      setError("that picture couldn't be used")
    } finally {
      setBusy(false)
      if (input) input.value = ""
    }
  }
  const button = "flex h-8 items-center rounded-lg px-3 text-[13px] text-muted outline-none hover:bg-[var(--hover-bg)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
  return (
    <div class="flex flex-col gap-1.5" data-component="wallpaper">
      <div class="flex items-center gap-2">
        <Show when={props.look.wallpaper}>
          {(src) => <span class="h-8 w-12 shrink-0 rounded-md bg-cover bg-center" style={{ "background-image": `url("${src()}")`, "box-shadow": "inset 0 0 0 1px var(--hairline)" }} aria-hidden="true" />}
        </Show>
        <button type="button" class={button} disabled={busy()} onClick={() => input?.click()}>
          {busy() ? "reading picture…" : props.look.wallpaper ? "change wallpaper" : "choose wallpaper"}
        </button>
        <Show when={props.look.wallpaper}>
          <button type="button" class={button} onClick={() => props.onChange({ ...props.look, wallpaper: null })}>
            remove
          </button>
        </Show>
        <input ref={input} type="file" accept="image/*" class="hidden" onChange={(e) => void pick(e.currentTarget.files?.[0])} />
      </div>
      <Show when={error()}>
        <span class="text-[12px] text-[var(--danger)]">{error()}</span>
      </Show>
    </div>
  )
}

export function LookPicker(props: { look: Look; onChange: (next: Look) => void; size?: "md" | "lg" }) {
  const big = () => props.size === "lg"
  const style = () => styleOf(props.look, appearanceOf(props.look.mode))
  return (
    <div class="flex flex-col gap-5" data-component="look-picker">
      <div class="grid grid-cols-3 gap-1" role="radiogroup" aria-label="style">
        <For each={STYLES}>{(s) => <StyleCard style={s} on={style() === s} onPick={() => props.onChange(withStyle(props.look, s))} />}</For>
      </div>
      <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="appearance">
        <For each={MODES}>
          {(mode) => (
            <button
              type="button"
              role="radio"
              aria-checked={props.look.mode === mode}
              data-mode={mode}
              class="flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] text-muted outline-none hover:bg-[var(--hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:bg-[var(--selected-bg)] aria-checked:text-text"
              onClick={() => props.onChange({ ...props.look, mode })}
            >
              <HugeIcon icon={MODE_ICON[mode]} size={15} />
              {mode}
            </button>
          )}
        </For>
      </div>
      <WallpaperRow look={props.look} onChange={props.onChange} />
      <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="colour">
        <For each={SWATCHES}>
          {(s) => {
            const on = () => presetOf(props.look) === s.id
            return (
              <button
                type="button"
                role="radio"
                aria-checked={on()}
                aria-label={s.label}
                title={s.label}
                data-preset={s.id}
                class="grid place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                classList={{ "size-10": big(), "size-8": !big() }}
                onClick={() => props.onChange({ ...props.look, theme: { preset: s.id } })}
              >
                <span
                  class="block rounded-full"
                  classList={{ "size-7": big(), "size-6": !big() }}
                  style={{
                    background: s.id === "mono" ? "linear-gradient(135deg, #111 50%, #fff 50%)" : swatchColor(s.id),
                    "box-shadow": on() ? `0 0 0 2px var(--bg), 0 0 0 4px ${s.id === "mono" ? "var(--text)" : swatchColor(s.id)}` : "none",
                  }}
                />
              </button>
            )
          }}
        </For>
      </div>
      <Show
        when={props.look.wallpaper && props.look.material === "frost"}
        fallback={<Slider label="tint" value={props.look.tint} onInput={(tint) => props.onChange({ ...props.look, tint })} />}
      >
        <WallpaperControls look={props.look} onChange={props.onChange} />
      </Show>
    </div>
  )
}
