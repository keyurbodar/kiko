// The color theme select: the settings select (settings/select.tsx) with each theme's swatch, and
// export and remove on imported themes, always shown.
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ShareIcon, TrashIcon } from "@kiko/ui/icons"
import { Show, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import { iconButtonClass } from "../settings/kit"
import { Select } from "../settings/select"
import type { ThemeColors } from "./palette"

export type ThemeOption = {
  id: string | null
  label: string
  colors: ThemeColors
  /** A muted word after the name: where it came from. */
  note?: string
  onExport?: () => void
  onRemove?: () => void
}

/** A theme in miniature: a small ball of its canvas with its accent glowing from one side. */
export function Swatch(props: { colors: ThemeColors }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class="block size-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_18%,transparent)]"
      style={{ background: `radial-gradient(circle at 30% 30%, ${props.colors.accent} 0%, color-mix(in oklab, ${props.colors.accent} 45%, ${props.colors.canvas}) 45%, ${props.colors.canvas} 75%)` }}
    />
  )
}

/** The color theme row's select: each theme with its swatch, imported ones with export and remove. */
export function ThemeSelect(props: { value: string | null; options: readonly ThemeOption[]; onPick: (id: string | null) => void }): JSX.Element {
  return (
    <Select
      label="Color theme"
      value={props.value}
      width={260}
      data-component="theme-select"
      onChange={props.onPick}
      options={props.options.map((o) => ({
        value: o.id,
        label: o.label,
        note: o.note,
        icon: <Swatch colors={o.colors} />,
        actions:
          o.onExport || o.onRemove ? (
            <>
              <Show when={o.onExport}>
                <button type="button" class={iconButtonClass} title="Export theme file" aria-label={`Export ${o.label}`} onClick={() => o.onExport!()}>
                  <HugeIcon icon={ShareIcon} size={13} />
                </button>
              </Show>
              <Show when={o.onRemove}>
                <button type="button" class={cn(iconButtonClass, "hover:text-[var(--danger)]")} title="Remove theme" aria-label={`Remove ${o.label}`} data-action="remove-theme" onClick={() => o.onRemove!()}>
                  <HugeIcon icon={TrashIcon} size={13} />
                </button>
              </Show>
            </>
          ) : undefined,
      }))}
    />
  )
}
