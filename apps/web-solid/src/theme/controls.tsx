// The appearance settings' controls, after monocode's (MIT, src/features/settings/ui/SettingsView.tsx):
// a titled group of rows, each a label with a short description and its control on the right.
// Kiko draws no borders, so groups are a fill and rows split with a hairline shadow.
import { For, Show, type JSX } from "solid-js"

export const button =
  "inline-flex h-7 items-center gap-1.5 rounded-lg bg-[var(--btn-bg)] px-2.5 text-xs text-text outline-none hover:bg-[var(--btn-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"

export const iconButton =
  "grid size-7 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-[var(--hover-bg)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)]"

export function Group(props: { title: string; description?: string; action?: JSX.Element; id?: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="flex flex-col gap-2.5" data-setting-group={props.id}>
      <div class="flex items-end gap-4">
        <div class="min-w-0 flex-1">
          <h2 class="text-[13px] font-semibold text-text">{props.title}</h2>
          <Show when={props.description}>
            <p class="mt-1 text-xs leading-relaxed text-muted">{props.description}</p>
          </Show>
        </div>
        <Show when={props.action}>
          <div class="shrink-0">{props.action}</div>
        </Show>
      </div>
      <div class="overflow-hidden rounded-xl bg-[var(--card)]">{props.children}</div>
    </section>
  )
}

export function Row(props: { label: string; description?: string; id?: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 [&+&]:shadow-[inset_0_1px_0_var(--hairline)]" data-setting={props.id}>
      <div class="min-w-[12rem] flex-1">
        <div class="text-[13px] font-medium text-text">{props.label}</div>
        <Show when={props.description}>
          <p class="mt-0.5 text-xs leading-relaxed text-muted">{props.description}</p>
        </Show>
      </div>
      <div class="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">{props.children}</div>
    </div>
  )
}

export function Segmented<T extends string>(props: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      class="inline-grid max-w-full gap-0.5 rounded-lg bg-[var(--tint-subtle)] p-0.5 text-xs"
      style={{ "grid-template-columns": `repeat(${props.options.length}, minmax(0, 1fr))` }}
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === option.value}
            data-value={option.value}
            class="min-w-0 truncate rounded-md px-2.5 py-1 text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-checked:bg-[var(--surface-raised)] aria-checked:text-text aria-checked:shadow-[0_1px_2px_oklch(0%_0_none/0.12)]"
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

export function Slider(props: { label: string; value: number; display: string; min: number; max: number; disabled?: boolean; onChange: (value: number) => void }): JSX.Element {
  return (
    <div class="flex w-56 max-w-full items-center gap-3" classList={{ "opacity-40": props.disabled }}>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        aria-label={props.label}
        disabled={props.disabled}
        class="h-1 min-w-0 flex-1 accent-[var(--accent)] disabled:cursor-not-allowed"
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <span class="w-10 shrink-0 text-right text-xs tabular-nums text-text">{props.display}</span>
    </div>
  )
}

export function Toggle(props: { label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-label={props.label}
      aria-checked={props.on}
      disabled={props.disabled}
      class="relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
      classList={{ "bg-[var(--accent)]": props.on, "bg-[var(--tint-strong)]": !props.on }}
      onClick={() => props.onChange(!props.on)}
    >
      <span class="absolute top-0.5 size-4 rounded-full bg-white shadow-sm" classList={{ "left-[18px]": props.on, "left-0.5": !props.on }} />
    </button>
  )
}
