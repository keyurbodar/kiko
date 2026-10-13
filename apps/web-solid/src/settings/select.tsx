// The settings select, t3code's (MIT, apps/web/src/components/ui/select.tsx): a bevelled trigger
// with the value and a faded chevron, opening a short list where the chosen option has a check in
// a fixed gutter on the left. The list is in a portal so no card clips it, under the trigger's
// right edge or above it when the window has no room below. An option may carry an icon before
// its name and buttons after it, always shown.
//
// The keyboard is a listbox's: the list takes focus with the chosen option active, the arrows,
// Home and End move, a letter jumps to the next option starting with it, Enter or Space picks,
// and Escape closes. Tab walks to the option buttons, and out of the panel it closes. Every
// close puts focus back on the trigger. The buttons sit in their own column beside the listbox,
// so the listbox holds only options.
import { DismissableLayerV2 } from "@kiko/ui/v2/dismissable-layer-v2"
import { For, Show, createSignal, createUniqueId, type JSX } from "solid-js"
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

export function Select<T>(props: { label: string; value: T; options: readonly SelectOption<T>[]; onChange: (value: T) => void; width?: number; class?: string; "data-component"?: string }): JSX.Element {
  const id = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const [active, setActive] = createSignal(0)
  const [place, setPlace] = createSignal<JSX.CSSProperties>({})
  let trigger: HTMLButtonElement | undefined
  let list: HTMLDivElement | undefined
  const chosenIndex = () => Math.max(0, props.options.findIndex((o) => o.value === props.value))
  const chosen = () => props.options[chosenIndex()]
  const hasActions = () => props.options.some((o) => o.actions)

  const show = () => {
    const r = trigger!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8 >= PANEL_H
    setPlace({
      right: `${Math.max(8, window.innerWidth - r.right)}px`,
      "min-width": `${Math.max(r.width, props.width ?? 0)}px`,
      ...(below ? { top: `${r.bottom + 4}px` } : { bottom: `${window.innerHeight - r.top + 4}px` }),
    })
    setActive(chosenIndex())
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    trigger?.focus()
    // An outside click on nothing focusable drops focus on the body after this, so it comes back.
    // A click on another control keeps that control's focus.
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) trigger?.focus()
    })
  }
  const pick = (value: T) => {
    props.onChange(value)
    close()
  }
  const move = (index: number) => {
    setActive(index)
    list?.querySelector(`#${CSS.escape(`${id}-${index}`)}`)?.scrollIntoView({ block: "nearest" })
  }

  const onListKey = (event: KeyboardEvent) => {
    const n = props.options.length
    const at = active()
    const key = event.key
    if (key === "ArrowDown") move(Math.min(n - 1, at + 1))
    else if (key === "ArrowUp") move(Math.max(0, at - 1))
    else if (key === "Home") move(0)
    else if (key === "End") move(n - 1)
    else if (key === "Enter" || key === " ") {
      const option = props.options[at]
      if (option) pick(option.value)
    } else if (key === "Escape") close()
    else if (key.length === 1 && /\S/.test(key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // The next option after the active one whose name starts with the letter, wrapping round.
      const letter = key.toLowerCase()
      for (let step = 1; step <= n; step += 1) {
        const index = (at + step) % n
        if (props.options[index]!.label.toLowerCase().startsWith(letter)) {
          move(index)
          break
        }
      }
    } else return
    event.preventDefault()
    event.stopPropagation()
  }

  // Tab out of the panel, either way, closes it.
  const onPanelKey = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return
    const stops = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[role=listbox], button")]
    const edge = event.shiftKey ? stops[0] : stops[stops.length - 1]
    if (document.activeElement !== edge) return
    event.preventDefault()
    close()
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        class={props.class ? `${selectClass} ${props.class}` : selectClass}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={open() ? id : undefined}
        aria-label={`${props.label}: ${chosen()?.label ?? ""}`}
        data-component={props["data-component"]}
        onClick={() => (open() ? close() : show())}
        onKeyDown={(e) => {
          if (!open() && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault()
            show()
          }
        }}
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
            onDismiss={close}
            excludedElements={() => [trigger]}
            class="bg-menu fixed z-50 flex max-h-[320px] max-w-[min(320px,calc(100vw-16px))] items-start overflow-y-auto rounded-xl p-1 shadow-popover"
            style={place()}
            onKeyDown={onPanelKey}
          >
            <div
              ref={(el) => {
                list = el
                queueMicrotask(() => {
                  el.focus()
                  move(active())
                })
              }}
              id={id}
              role="listbox"
              tabindex="0"
              aria-label={props.label}
              aria-activedescendant={`${id}-${active()}`}
              class="kit-listbox flex min-w-0 flex-1 flex-col"
              onKeyDown={onListKey}
            >
              <For each={props.options}>
                {(option, i) => {
                  const selected = () => option.value === props.value
                  return (
                    <div
                      id={`${id}-${i()}`}
                      role="option"
                      aria-selected={selected()}
                      class="flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-lg pr-2 pl-1.5 text-[13.5px] text-text"
                      classList={{ "bg-[color-mix(in_oklab,var(--text)_8%,transparent)]": active() === i() }}
                      data-option={String(option.value)}
                      onPointerMove={() => setActive(i())}
                      onClick={() => pick(option.value)}
                    >
                      <span class="grid size-4 shrink-0 place-items-center" aria-hidden="true">
                        <Show when={selected()}>
                          <svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3.5 8.5l3 3 6-7" />
                          </svg>
                        </Show>
                      </span>
                      <Show when={option.icon}>{option.icon}</Show>
                      <span class="min-w-0 flex-1 truncate">
                        {option.label}
                        <Show when={option.note}>
                          <span class="ml-1.5 text-[var(--kit-meta)]">{option.note}</span>
                        </Show>
                      </span>
                    </div>
                  )
                }}
              </For>
            </div>
            <Show when={hasActions()}>
              <div class="flex shrink-0 flex-col">
                <For each={props.options}>{(option) => <div class="flex h-8 items-center justify-end gap-0.5 pr-0.5">{option.actions}</div>}</For>
              </div>
            </Show>
          </DismissableLayerV2>
        </Portal>
      </Show>
    </>
  )
}
