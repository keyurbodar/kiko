// The theme library as t3code draws it (MIT, apps/web/src/components/settings/ThemeSettings.tsx
// ThemeLibraryCard, ThemePreviewCircles.tsx, packages/shared/src/themePreview.ts): a grid of cards,
// each with a ball per mode the theme draws. A ball sets the theme for that mode only; the name
// sets it for every mode it draws. A mode's ball wears a ring and a sun or moon while it is set.
import { HugeIcon } from "@kiko/ui/huge-icon"
import { MoonIcon, ShareIcon, SunIcon, TrashIcon } from "@kiko/ui/icons"
import { For, Show, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import { iconButtonClass } from "../settings/kit"
import type { ThemeAppearance, ThemeColors } from "./palette"

type Spec = {
  baseTarget: string
  baseWeight: number
  accent: { center: readonly [number, number]; middleOffset: number; middleOpacity: number; endOffset: number }
  action: { center: readonly [number, number]; startOpacity: number; endOffset: number }
}

/** t3code's preview render specs, per mode. */
const SPECS: Record<ThemeAppearance, Spec> = {
  light: { baseTarget: "#ffffff", baseWeight: 0.8, accent: { center: [0.72, 0.22], middleOffset: 0.28, middleOpacity: 0.72, endOffset: 0.58 }, action: { center: [0.18, 0.82], startOpacity: 0.45, endOffset: 0.55 } },
  dark: { baseTarget: "#09090b", baseWeight: 0.8, accent: { center: [0.28, 0.78], middleOffset: 0.28, middleOpacity: 0.62, endOffset: 0.58 }, action: { center: [0.82, 0.18], startOpacity: 0.45, endOffset: 0.55 } },
}

/** A theme's colors for one mode as a soft ball: the canvas, with the accent glowing from one corner. */
function previewStyle(colors: ThemeColors, mode: ThemeAppearance): JSX.CSSProperties {
  const spec = SPECS[mode]
  const at = (c: readonly [number, number]) => `${c[0] * 100}% ${c[1] * 100}%`
  return {
    "background-color": `color-mix(in oklab, ${colors.canvas} ${spec.baseWeight * 100}%, ${spec.baseTarget})`,
    "background-image": [
      `radial-gradient(circle at ${at(spec.accent.center)} in oklab, ${colors.accent} 0%, color-mix(in oklab, ${colors.accent} ${spec.accent.middleOpacity * 100}%, transparent) ${spec.accent.middleOffset * 100}%, transparent ${spec.accent.endOffset * 100}%)`,
      `radial-gradient(circle at ${at(spec.action.center)} in oklab, color-mix(in oklab, ${colors.messageAction} ${spec.action.startOpacity * 100}%, transparent) 0%, transparent ${spec.action.endOffset * 100}%)`,
    ].join(", "),
    filter: "blur(3px)",
    transform: "scale(1.1)",
  }
}

function Ball(props: { colors: ThemeColors; mode: ThemeAppearance }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class="relative block size-14 shrink-0 overflow-hidden rounded-full border-2 border-[var(--bg)]"
      style={{ "box-shadow": props.mode === "dark" ? "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)" : "inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)" }}
    >
      <span class="absolute inset-0 rounded-full" style={previewStyle(props.colors, props.mode)} />
    </span>
  )
}

export type ThemeCardProps = {
  label: string
  /** The colors per mode the theme draws. A mode it does not draw has no ball. */
  colors: Partial<Record<ThemeAppearance, ThemeColors>>
  /** The modes this theme is set for now. */
  activeModes: readonly ThemeAppearance[]
  disabled?: boolean
  note?: string
  onUse: () => void
  onUseMode: (mode: ThemeAppearance) => void
  onExport?: () => void
  onRemove?: () => void
  id: string
}

export function ThemeCard(props: ThemeCardProps): JSX.Element {
  const modes = () => (["light", "dark"] as const).filter((m) => props.colors[m])
  const active = () => props.activeModes.length > 0
  return (
    <div
      class={cn(
        "overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--text)_10%,transparent)] bg-[color-mix(in_oklab,var(--text)_3%,transparent)]",
        active() && "bg-[color-mix(in_oklab,var(--text)_6%,transparent)] shadow-[inset_0_0_0_1px_var(--accent)]",
        props.disabled && "opacity-50",
      )}
      data-theme-card={props.id}
      aria-current={active() ? "true" : undefined}
    >
      <div class="flex min-h-[84px] items-center justify-center gap-2.5 px-3 pt-3">
        <For each={modes()} fallback={<span class="text-[12px] text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{props.note}</span>}>
          {(mode) => {
            const picked = () => props.activeModes.includes(mode)
            return (
              <button
                type="button"
                disabled={props.disabled}
                class="relative grid size-[68px] shrink-0 cursor-pointer place-items-center rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-default"
                aria-label={`use ${props.label} for ${mode} mode`}
                aria-pressed={picked()}
                title={mode === "light" ? "use for light mode" : "use for dark mode"}
                onClick={() => props.onUseMode(mode)}
              >
                <Ball colors={props.colors[mode]!} mode={mode} />
                <Show when={picked()}>
                  <span aria-hidden="true" class="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_var(--accent)]" />
                  <span aria-hidden="true" class="pointer-events-none absolute right-0.5 bottom-0.5 grid size-5 place-items-center rounded-full border border-[color-mix(in_oklab,var(--text)_14%,transparent)] bg-[var(--bg)] text-text">
                    <HugeIcon icon={mode === "light" ? SunIcon : MoonIcon} size={12} />
                  </span>
                </Show>
              </button>
            )
          }}
        </For>
      </div>
      <div class="flex items-center gap-2 px-3 pt-2 pb-3">
        <button
          type="button"
          disabled={props.disabled}
          class="min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left text-[13px] font-medium text-text outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-default"
          aria-pressed={active()}
          aria-label={`use ${props.label}`}
          onClick={() => props.onUse()}
        >
          {props.label}
          <Show when={props.note && modes().length}>
            <span class="ml-2 text-[12px] font-normal text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{props.note}</span>
          </Show>
        </button>
        <Show when={props.onExport}>
          <button type="button" class={iconButtonClass} title="export theme file" aria-label={`export ${props.label}`} onClick={() => props.onExport!()}>
            <HugeIcon icon={ShareIcon} size={14} />
          </button>
        </Show>
        <Show when={props.onRemove}>
          <button type="button" class={cn(iconButtonClass, "hover:text-[var(--danger)]")} title="remove theme" aria-label={`remove ${props.label}`} data-action="remove-theme" onClick={() => props.onRemove!()}>
            <HugeIcon icon={TrashIcon} size={14} />
          </button>
        </Show>
      </div>
    </div>
  )
}

/** t3code's grid: as many 16rem cards as fit, one per row on a phone. */
export const themeGridClass = "grid w-full gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]"
