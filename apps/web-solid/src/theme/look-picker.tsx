import { For } from "solid-js"
import { HugeIcon, type IconKey } from "@kiko/ui/huge-icon"
import { appearanceOf } from "./apply"
import type { Look, Mode, Style } from "./look"
import { MODES, presetOf, STYLES, styleOf, withStyle } from "./look"
import { SWATCHES, swatchColor } from "./presets"

/*
 * The look controls: a style, an appearance, a colour, and how much that colour tints the
 * greys. Settings and the first-run screen both use it. A click saves at once: the look is
 * instant, so there is nothing to confirm.
 */

const MODE_ICON: Record<Mode, IconKey> = { system: "monitor", light: "sun", dark: "moon" }

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
              <HugeIcon name={MODE_ICON[mode]} size={15} />
              {mode}
            </button>
          )}
        </For>
      </div>
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
      <label class="flex items-center gap-3 text-[13px] text-muted" data-component="tint">
        <span class="w-10 shrink-0">tint</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          class="h-1 min-w-0 flex-1 accent-[var(--accent-fill)]"
          aria-label="tint"
          value={Math.round(props.look.tint * 100)}
          onInput={(e) => props.onChange({ ...props.look, tint: Number(e.currentTarget.value) / 100 })}
        />
        <span class="w-9 shrink-0 text-right text-[11px] tabular-nums text-faint">{Math.round(props.look.tint * 100)}%</span>
      </label>
    </div>
  )
}
