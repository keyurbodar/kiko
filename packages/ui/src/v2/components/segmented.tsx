import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import "./segmented.css"

export type SegmentedOption<T extends string> = { value: T; label: string }

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

function nextIndex(key: string, at: number, n: number) {
  if (key === "Home") return 0
  if (key === "End") return n - 1
  const delta = STEPS[key]
  return delta === undefined ? -1 : (Math.max(at, 0) + delta + n) % n
}

export function Segmented<T extends string>(props: {
  label: string
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  class?: string
}) {
  let track!: HTMLDivElement
  const [pill, setPill] = createSignal<{ x: number; w: number } | null>(null)
  const [settled, setSettled] = createSignal(false)
  const at = () => props.options.findIndex((o) => o.value === props.value)
  const measure = () => {
    const el = track.querySelector<HTMLElement>('[aria-checked="true"]')
    setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
  }
  onMount(() => {
    measure()
    requestAnimationFrame(() => setSettled(true))
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    onCleanup(() => observer.disconnect())
  })
  createEffect(on([() => props.value, () => props.options.length], measure, { defer: true }))
  const step = (event: KeyboardEvent) => {
    const next = nextIndex(event.key, at(), props.options.length)
    if (next < 0) return
    event.preventDefault()
    props.onChange(props.options[next]!.value)
    track.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus()
  }
  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={props.label}
      data-component="segmented"
      data-settled={settled() ? "" : undefined}
      class={props.class}
      onKeyDown={step}
    >
      <Show when={pill()}>
        {(p) => (
          <span
            aria-hidden="true"
            data-slot="segmented-pill"
            style={{ width: `${p().w}px`, transform: `translateX(${p().x}px)` }}
          />
        )}
      </Show>
      <For each={props.options}>
        {(option, i) => {
          const on = () => props.value === option.value
          return (
            <button
              type="button"
              role="radio"
              aria-checked={on()}
              tabindex={on() || (i() === 0 && at() < 0) ? 0 : -1}
              data-value={option.value}
              data-slot="segmented-item"
              onClick={() => props.onChange(option.value)}
            >
              {option.label}
            </button>
          )
        }}
      </For>
    </div>
  )
}
