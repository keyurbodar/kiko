// The theme for one mode, as monocode's settings pick anything: a small trigger in a row that opens
// a short list (MIT, monocode src/features/settings/ui/SettingsView.tsx `Select`). Each option is a
// tiny swatch and a name; the chosen one has a check. Imported themes carry their export and remove
// buttons in the list, always shown.
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ShareIcon, TrashIcon } from "@kiko/ui/icons"
import { DismissableLayerV2 } from "@kiko/ui/v2/dismissable-layer-v2"
import { For, Show, createSignal, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { cn } from "../lib/cn"
import { buttonClass, iconButtonClass } from "../settings/kit"
import type { ThemeAppearance, ThemeColors } from "./palette"

export type ThemeOption = {
  id: string | null
  label: string
  colors: ThemeColors
  /** A muted word after the name: where it came from. */
  note?: string
  onExport?: () => void
  onRemove?: () => void
}

/** A theme in miniature: its canvas with its accent as a dot. */
export function Swatch(props: { colors: ThemeColors }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class="grid size-4 shrink-0 place-items-center rounded-[5px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_16%,transparent)]"
      style={{ background: props.colors.canvas }}
    >
      <span class="size-1.5 rounded-full" style={{ background: props.colors.accent }} />
    </span>
  )
}

const PANEL_W = 280
const PANEL_H = 320

export function ThemeSelect(props: { half: ThemeAppearance; value: string | null; options: readonly ThemeOption[]; onPick: (id: string | null) => void }): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [place, setPlace] = createSignal<JSX.CSSProperties>({})
  let trigger: HTMLButtonElement | undefined
  const chosen = () => props.options.find((o) => o.id === props.value) ?? props.options[0]
  const show = () => {
    // In a portal so no card clips it: under the trigger's right edge, or above it near the bottom.
    const r = trigger!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8 >= PANEL_H
    setPlace({ right: `${Math.max(8, window.innerWidth - r.right)}px`, ...(below ? { top: `${r.bottom + 4}px` } : { bottom: `${window.innerHeight - r.top + 4}px` }) })
    setOpen(true)
  }
  const pick = (id: string | null) => {
    props.onPick(id)
    setOpen(false)
    trigger?.focus()
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        class={buttonClass("secondary", "max-w-52 justify-between gap-2")}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-label={`${props.half} theme: ${chosen()?.label ?? "kiko"}`}
        data-component="theme-select"
        data-half={props.half}
        onClick={() => (open() ? setOpen(false) : show())}
      >
        <span class="flex min-w-0 items-center gap-2">
          <Show when={chosen()}>{(o) => <Swatch colors={o().colors} />}</Show>
          <span class="truncate">{chosen()?.label}</span>
        </span>
        <svg class="size-3.5 shrink-0 opacity-60" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <Show when={open()}>
        <Portal>
          <DismissableLayerV2
            active={open()}
            onDismiss={() => setOpen(false)}
            excludedElements={() => [trigger]}
            class="bg-menu fixed z-50 flex max-h-[320px] flex-col overflow-y-auto rounded-xl p-1 shadow-popover"
            style={{ ...place(), width: `${PANEL_W}px` }}
            role="listbox"
            aria-label={`${props.half} theme`}
          >
            <For each={props.options}>
              {(option) => {
                const selected = () => option.id === props.value
                return (
                  <div class="flex items-center rounded-lg hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)] has-[:focus-visible]:bg-[color-mix(in_oklab,var(--text)_8%,transparent)]" classList={{ "bg-[var(--selected-bg)]": selected() }}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected()}
                      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-[12px] text-text outline-none"
                      data-theme-option={option.id ?? "default"}
                      onClick={() => pick(option.id)}
                    >
                      <Swatch colors={option.colors} />
                      <span class="min-w-0 flex-1 truncate">
                        {option.label}
                        <Show when={option.note}>
                          <span class="ml-1.5 text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{option.note}</span>
                        </Show>
                      </span>
                      <Show when={selected()}>
                        <svg class="size-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M3.5 8.5l3 3 6-7" />
                        </svg>
                      </Show>
                    </button>
                    <Show when={option.onExport}>
                      <button type="button" class={cn(iconButtonClass, "size-6")} title="export theme file" aria-label={`export ${option.label}`} onClick={() => option.onExport!()}>
                        <HugeIcon icon={ShareIcon} size={13} />
                      </button>
                    </Show>
                    <Show when={option.onRemove}>
                      <button type="button" class={cn(iconButtonClass, "mr-0.5 size-6 hover:text-[var(--danger)]")} title="remove theme" aria-label={`remove ${option.label}`} data-action="remove-theme" onClick={() => option.onRemove!()}>
                        <HugeIcon icon={TrashIcon} size={13} />
                      </button>
                    </Show>
                  </div>
                )
              }}
            </For>
          </DismissableLayerV2>
        </Portal>
      </Show>
    </>
  )
}
