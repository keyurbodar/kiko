import { For } from "solid-js"
import type { Look, Mode } from "./look"
import { MODES, presetOf } from "./look"
import { SWATCHES, swatchColor } from "./presets"

/*
 * The appearance row and the swatch row. Settings and the first-run screen both use it.
 * A click saves at once: the look is instant, so there is nothing to confirm.
 */

const MODE_ICON: Record<Mode, string> = {
  system: "M2.5 3.5h11v7.5h-11zM6 13.5h4M8 11v2.5",
  light: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1",
  dark: "M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z",
}

export function LookPicker(props: { look: Look; onChange: (next: Look) => void; size?: "md" | "lg" }) {
  const big = () => props.size === "lg"
  return (
    <div class="flex flex-col gap-4" data-component="look-picker">
      <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="appearance">
        <For each={MODES}>
          {(mode) => (
            <button
              type="button"
              role="radio"
              aria-checked={props.look.mode === mode}
              data-mode={mode}
              class="flex h-10 items-center gap-2 rounded-[10px] px-3.5 text-sm text-muted outline-none hover:bg-[var(--btn-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:bg-[var(--btn-bg-hover)] aria-checked:text-text"
              onClick={() => props.onChange({ ...props.look, mode })}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d={MODE_ICON[mode]} />
              </svg>
              {mode}
            </button>
          )}
        </For>
      </div>
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="theme">
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
                class="grid place-items-center rounded-xl outline-none hover:bg-[var(--btn-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:bg-[var(--btn-bg-hover)]"
                classList={{ "size-14": big(), "size-12": !big() }}
                onClick={() => props.onChange({ ...props.look, theme: { preset: s.id } })}
              >
                <span
                  class="block rounded-full"
                  classList={{ "size-9": big(), "size-8": !big() }}
                  style={{
                    background: s.id === "mono" ? "linear-gradient(135deg, #111 50%, #fff 50%)" : swatchColor(s.id),
                    "box-shadow": on() ? `0 0 0 2px var(--bg), 0 0 0 4px ${s.id === "mono" ? "var(--text)" : swatchColor(s.id)}` : "inset 0 0 0 1px oklch(0.5 0 0 / 0.25)",
                  }}
                />
              </button>
            )
          }}
        </For>
      </div>
    </div>
  )
}
