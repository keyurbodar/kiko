// The settings select, t3code's (MIT, apps/web/src/components/ui/select.tsx): a bevelled trigger
// with the value and a faded chevron, opening a short list where the chosen option has a check.
// The list is in a portal so no card clips it, under the trigger's right edge or above it when the
// window has no room below. An option may carry an icon before its name and buttons after it,
// always shown.
import { DismissableLayerV2 } from "@kiko/ui/v2/dismissable-layer-v2"
import { For, Show, createSignal, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { selectClass } from "./kit"

export type SelectOption<T> = {
  value: T
  label: string
  icon?: JSX.Element
  /** A muted word after the name. */
  note?: string
  /** Buttons after the option, such as export and remove. */
  actions?: JSX.Element
}

const PANEL_H = 320

export function Select<T>(props: { label: string; value: T; options: readonly SelectOption<T>[]; onChange: (value: T) => void; width?: number; "data-component"?: string }): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [place, setPlace] = createSignal<JSX.CSSProperties>({})
  let trigger: HTMLButtonElement | undefined
  const chosen = () => props.options.find((o) => o.value === props.value) ?? props.options[0]
  const show = () => {
    const r = trigger!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8 >= PANEL_H
    setPlace({
      right: `${Math.max(8, window.innerWidth - r.right)}px`,
      "min-width": `${Math.max(r.width, props.width ?? 0)}px`,
      ...(below ? { top: `${r.bottom + 4}px` } : { bottom: `${window.innerHeight - r.top + 4}px` }),
    })
    setOpen(true)
  }
  const pick = (value: T) => {
    props.onChange(value)
    setOpen(false)
    trigger?.focus()
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        class={selectClass}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-label={`${props.label}: ${chosen()?.label ?? ""}`}
        data-component={props["data-component"]}
        onClick={() => (open() ? setOpen(false) : show())}
      >
        <span class="flex min-w-0 items-center gap-2">
          <Show when={chosen()?.icon}>{chosen()!.icon}</Show>
          <span class="truncate">{chosen()?.label}</span>
        </span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <Show when={open()}>
        <Portal>
          <DismissableLayerV2
            active={open()}
            onDismiss={() => setOpen(false)}
            excludedElements={() => [trigger]}
            class="bg-menu fixed z-50 flex max-h-[320px] max-w-[min(320px,calc(100vw-16px))] flex-col overflow-y-auto rounded-xl p-1 shadow-popover"
            style={place()}
            role="listbox"
            aria-label={props.label}
          >
            <For each={props.options}>
              {(option) => {
                const selected = () => option.value === props.value
                return (
                  <div
                    class="flex items-center rounded-lg hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)] has-[:focus-visible]:bg-[color-mix(in_oklab,var(--text)_8%,transparent)]"
                    classList={{ "bg-[var(--selected-bg)]": selected() }}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected()}
                      class="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-left text-[13.5px] text-text outline-none"
                      data-option={String(option.value)}
                      onClick={() => pick(option.value)}
                    >
                      <Show when={option.icon}>{option.icon}</Show>
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
                    <Show when={option.actions}>{option.actions}</Show>
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
