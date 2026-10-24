import { DismissableLayerV2 } from "@kiko/ui/v2/dismissable-layer-v2"
import { For, Show, createEffect, createSignal, createUniqueId, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { selectClass } from "./kit"
import { placePanel } from "../lib/place-panel"

export type SelectOption<T> = {
  value: T
  label: string
  icon?: JSX.Element
  note?: string
  actions?: JSX.Element
}

const PANEL_H = 320

export function Select<T>(props: {
  label: string
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  width?: number
  class?: string
  "data-component"?: string
}): JSX.Element {
  const id = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const [active, setActive] = createSignal(0)
  const [place, setPlace] = createSignal<JSX.CSSProperties>({})
  let trigger: HTMLButtonElement | undefined
  let list: HTMLDivElement | undefined
  const chosenIndex = () =>
    Math.max(
      0,
      props.options.findIndex((o) => o.value === props.value),
    )
  const chosen = () => props.options[chosenIndex()]
  const hasActions = () => props.options.some((o) => o.actions)

  const measure = () => {
    if (!trigger) return
    const r = trigger.getBoundingClientRect()
    const width = Math.max(r.width, props.width ?? 0)
    setPlace({
      ...placePanel(r, width, PANEL_H, { width: window.innerWidth, height: window.innerHeight }, "below", "end"),
      "min-width": `${width}px`,
    })
  }
  const show = () => {
    measure()
    setActive(chosenIndex())
    setOpen(true)
  }
  createEffect(() => {
    if (!open()) return
    const reposition = () => measure()
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    onCleanup(() => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    })
  })
  const close = () => {
    setOpen(false)
    trigger?.focus()
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
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <Show when={open()}>
        <Portal>
          <DismissableLayerV2
            active={open()}
            onDismiss={close}
            excludedElements={() => [trigger]}
            class="bg-raise pointer-events-auto fixed z-[80] flex max-w-[min(320px,calc(100vw-16px))] items-start overflow-y-auto rounded-pop p-1 shadow-popover"
            style={place()}
            onKeyDown={onPanelKey}
            data-kb-top-layer=""
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
              tabIndex={0}
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
                      class="flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-row pr-2 pl-1.5 text-[13.5px] text-fg"
                      classList={{ "bg-[color-mix(in_oklab,var(--fg)_8%,transparent)]": active() === i() }}
                      data-option={String(option.value)}
                      onPointerMove={() => setActive(i())}
                      onClick={() => pick(option.value)}
                    >
                      <span class="grid size-4 shrink-0 place-items-center" aria-hidden="true">
                        <Show when={selected()}>
                          <svg
                            class="size-3.5"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
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
                <For each={props.options}>
                  {(option) => <div class="flex h-8 items-center justify-end gap-0.5 pr-0.5">{option.actions}</div>}
                </For>
              </div>
            </Show>
          </DismissableLayerV2>
        </Portal>
      </Show>
    </>
  )
}
