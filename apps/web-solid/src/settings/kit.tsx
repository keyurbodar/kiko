// The settings kit: every settings page is built from these, after monocode's settings view (MIT,
// src/features/settings/ui/SettingsView.tsx) and t3code's settings layout (MIT,
// apps/web/src/components/settings/settingsLayout.tsx). A page is a header, then titled groups;
// a group is one card of rows split by hairlines; a row is a label with a short description and
// its control on the right. Lists (providers, extensions, tools) are item rows in the same card.
import { For, Show, splitProps, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import "./kit.css"

// Controls, cards, and rows are t3code's (MIT, apps/web/src/components/ui and settings), drawn by
// the classes in kit.css. Page layout follows monocode's (MIT, src/features/settings/ui/SettingsView.tsx). Every color is the
// text color mixed over what is behind it, so both work on kiko's light, dark, and glass themes:
// `color-mix(in_oklab,var(--text)_N%,transparent)` below is t3code's `white/N` in dark mode.
//
// One rule keeps the page predictable: only something that looks like a button does anything.
// A card or a title is never a hidden click target, nothing appears only under the pointer, a
// choice in a list shows its radio, and anything that opens shows a "details" button.
const focus = "outline-none"

/** The one muted text color (kit.css `--kit-meta`): row and group descriptions, item meta, hints, empty lines. */
export const muted = "text-[var(--kit-meta)]"

/** The input border, t3code's `--input`. */
export const line = "border-[color-mix(in_oklab,var(--text)_12%,transparent)]"

type Variant = "primary" | "secondary" | "ghost" | "danger"

/** The class of a settings button (t3code's, kit.css), for an element that cannot be a `Button`. */
export function buttonClass(variant: Variant = "secondary", extra?: string) {
  return cn("kit-btn", `kit-btn--${variant}`, extra)
}

/** The class of a select's trigger (t3code's, kit.css): a value and a chevron. */
export const selectClass = "kit-select"

export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }): JSX.Element {
  const [local, rest] = splitProps(props, ["variant", "class", "type"])
  return <button type={local.type ?? "button"} class={buttonClass(local.variant, local.class)} {...rest} />
}

/** t3code's icon-sm ghost: a 28px square that is always there, never revealed by hover. */
export const iconButtonClass = cn(
  "grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-[color-mix(in_oklab,var(--text)_60%,transparent)] enabled:hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)] enabled:hover:text-text enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60",
  focus,
)

export function IconButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "danger", "class"])
  return (
    <button
      type="button"
      aria-label={local.label}
      title={local.label}
      class={cn(iconButtonClass, local.danger && "enabled:hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] enabled:hover:text-[var(--danger)]", local.class)}
      {...rest}
    />
  )
}

/** The button that opens and closes something under it: a word and a chevron that turns. */
export function DetailsButton(props: { open: boolean; onToggle: () => void; label?: string; class?: string; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["open", "onToggle", "label", "class"])
  return (
    <button type="button" class={buttonClass("ghost", local.class)} aria-expanded={local.open} onClick={() => local.onToggle()} {...rest}>
      {local.label ?? (local.open ? "Hide details" : "Details")}
      <svg class="size-3.5 shrink-0" classList={{ "rotate-180": local.open }} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  )
}

/** t3code's input (kit.css): 30px, 8px corners, bevelled, a ring on focus. */
export const fieldClass = "kit-field"

/** monocode's PageHeader, then the page's groups. */
export function Page(props: { title: string; description?: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="flex flex-col" data-component="settings-page">
      <header class="pb-4">
        <h1 class="text-[18px] font-semibold leading-tight text-text">{props.title}</h1>
        <Show when={props.description}>
          <p class={cn("mt-1.5 max-w-xl text-[13px] leading-relaxed", muted)}>{props.description}</p>
        </Show>
      </header>
      {props.children}
    </div>
  )
}

/** A titled card of rows, t3code's settings group: a quiet heading over a 14px-cornered card. A page spaces its groups 32px apart. `bare` drops the card. */
export function Group(props: { title?: JSX.Element; description?: JSX.Element; action?: JSX.Element; id?: string; bare?: boolean; class?: string; children?: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["title", "description", "action", "id", "bare", "class", "children"])
  return (
    <section class={local.class} data-setting-group={local.id} {...rest}>
      <Show when={local.title || local.action}>
        <div class="flex items-end gap-4 px-1 pb-2.5">
          <div class="min-w-0 flex-1">
            <Show when={local.title}>
              <h2 class="text-[14px] font-normal text-[color-mix(in_oklab,var(--text)_70%,transparent)]">{local.title}</h2>
            </Show>
            <Show when={local.description}>
              <div class={cn("mt-1 text-[12px] leading-relaxed", muted)}>{local.description}</div>
            </Show>
          </div>
          <Show when={local.action}>
            <div class="flex shrink-0 items-center gap-2 pb-0.5">{local.action}</div>
          </Show>
        </div>
      </Show>
      <Show when={!local.bare} fallback={local.children}>
        <div class="kit-card">{local.children}</div>
      </Show>
    </section>
  )
}

/** The hairline under each row of a card, gone under the last: monocode's `border-b border-content/5 last:border-b-0`. */
export const rowLine = "border-b border-[color-mix(in_oklab,var(--text)_6%,transparent)] last:border-b-0"

/**
 * t3code's settings row: a 14px label and a muted line on the left, the control on the right.
 * Stacks in a narrow pane (kit.css). `details` sits under it, inside the same row, such as a
 * preview or a form the control opened.
 */
export function Row(props: { label: JSX.Element; description?: JSX.Element; id?: string; onReset?: () => void; details?: JSX.Element; class?: string; children?: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "description", "id", "onReset", "details", "class", "children"])
  return (
    <div class={cn("px-4", rowLine, local.class)} data-setting={local.id} {...rest}>
    <div class="settings-row flex items-center gap-8 py-3">
      <div class="min-w-0 flex-1">
        <div class="flex min-h-5 items-center gap-1.5 text-[14px] font-medium leading-5 text-text">
          {local.label}
          {/* t3code's reset: shown only while the setting differs from its default. */}
          <Show when={local.onReset}>
            <button
              type="button"
              class={cn("relative grid size-5 cursor-pointer place-items-center rounded-md outline-none before:absolute before:-inset-1.5 hover:bg-[var(--kit-hover)] hover:text-text", muted)}
              title="Reset to default"
              aria-label={`Reset ${typeof local.label === "string" ? local.label.toLowerCase() : "setting"} to default`}
              data-action="reset-setting"
              onClick={() => local.onReset!()}
            >
              <svg class="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
                <path d="M2.5 2.5v3h3" />
              </svg>
            </button>
          </Show>
        </div>
        <Show when={local.description}>
          <div class={cn("mt-0.5 max-w-xl text-[12px] leading-normal", muted)}>{local.description}</div>
        </Show>
      </div>
      <Show when={local.children}>
        <div class="settings-row-control flex min-w-0 max-w-[60%] shrink-0 flex-wrap items-center justify-end gap-2">{local.children}</div>
      </Show>
    </div>
    <Show when={local.details}>
      <div class="pb-3.5">{local.details}</div>
    </Show>
    </div>
  )
}

/**
 * A thing in a list, monocode's MCP and account rows: an icon tile, a name, a muted line, and its
 * actions. What opens under it (`children`) lines up with the name, not the icon. Pass it as an
 * expression such as `{open() && ...}`: a `Show` element is always something, so the row would
 * keep an empty gap under it.
 */
export function Item(props: {
  icon?: JSX.Element
  title: JSX.Element
  meta?: JSX.Element
  /** Only trouble gets a dot: a healthy item reads fine from its text. */
  trouble?: boolean
  actions?: JSX.Element
  children?: JSX.Element
  class?: string
  [data: `data-${string}`]: string | undefined
}): JSX.Element {
  const [local, rest] = splitProps(props, ["icon", "title", "meta", "trouble", "actions", "children", "class"])
  return (
    <div
      class={cn("grid items-center gap-x-3 px-4 py-2.5", local.icon ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]", rowLine, local.class)}
      {...rest}
    >
      <Show when={local.icon}>
        <span class="grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-[color-mix(in_oklab,var(--text)_5%,transparent)] text-[color-mix(in_oklab,var(--text)_60%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--text)_6%,transparent)]">
          {local.icon}
        </span>
      </Show>
      <div class="flex min-h-7 min-w-0 flex-col justify-center">
        <div class="flex items-center gap-1.5 truncate text-[13px] font-medium text-text">
          {local.title}
          <Show when={local.trouble}>
            <span class="size-1.5 shrink-0 rounded-full bg-[var(--danger)]" aria-hidden="true" />
          </Show>
        </div>
        <Show when={local.meta}>
          <div class={cn("mt-0.5 text-[12px] leading-snug", muted)}>{local.meta}</div>
        </Show>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">{local.actions}</div>
      <Show when={local.children}>
        <div class={cn("col-span-2 min-w-0 pt-3 pb-1", local.icon && "col-start-2")}>{local.children}</div>
      </Show>
    </div>
  )
}

/** A plain muted sentence with no box: an empty list, a loading list. A box around one line is noise. */
export function Hint(props: { children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  return (
    <p class={cn("text-[13px] leading-relaxed", muted)} {...rest}>
      {local.children}
    </p>
  )
}

/** One muted line inside a card, monocode's empty state: "No MCP servers configured." */
export function Empty(props: { children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  return (
    <div class={cn("px-4 py-3.5 text-[13px]", muted, rowLine)} {...rest}>
      {local.children}
    </div>
  )
}

/** An error as a line, not a panel: monocode's `text-[12px] text-red-400/90`. */
export function Notice(props: { tone?: "danger" | "muted"; children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["tone", "children"])
  return (
    <p role="alert" class={cn("text-[12px] leading-relaxed", local.tone === "muted" ? muted : "text-[color-mix(in_oklab,var(--danger)_90%,transparent)]")} {...rest}>
      {local.children}
    </p>
  )
}

/** t3code's badge: an 18px label with 4px corners. */
export function Pill(props: { tone?: "muted" | "accent" | "success" | "danger"; children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["tone", "children"])
  const tone = {
    muted: "bg-[color-mix(in_oklab,var(--text)_8%,transparent)] text-[color-mix(in_oklab,var(--text)_65%,transparent)]",
    accent: "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent)]",
    success: "bg-[color-mix(in_oklab,var(--success)_16%,transparent)] text-[var(--success)]",
    danger: "bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] text-[var(--danger)]",
  }[local.tone ?? "muted"]
  return (
    <span class={cn("inline-flex h-[18px] shrink-0 items-center rounded-sm px-1.5 text-[11px] font-medium leading-none whitespace-nowrap", tone)} {...rest}>
      {local.children}
    </span>
  )
}

/**
 * t3code's segmented toggle group (kit.css). One radio is in the tab order, the chosen one, and
 * the arrow keys move the choice, as a radio group does.
 */
export function Segmented<T extends string>(props: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }): JSX.Element {
  const step = (event: KeyboardEvent) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    const n = props.options.length
    const at = props.options.findIndex((o) => o.value === props.value)
    const next = event.key === "Home" ? 0 : event.key === "End" ? n - 1 : delta === undefined ? -1 : (Math.max(at, 0) + delta + n) % n
    if (next < 0) return
    event.preventDefault()
    props.onChange(props.options[next]!.value)
    ;(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={props.label} class="kit-seg" style={{ "grid-template-columns": `repeat(${props.options.length}, minmax(0, 1fr))` }} onKeyDown={step}>
      <For each={props.options}>
        {(option, i) => {
          const on = () => props.value === option.value
          // With no choice matching, the first radio takes the tab stop so the group stays reachable.
          const stop = () => on() || (i() === 0 && !props.options.some((o) => o.value === props.value))
          return (
            <button type="button" role="radio" aria-checked={on()} tabindex={stop() ? 0 : -1} data-value={option.value} class="kit-seg-item" onClick={() => props.onChange(option.value)}>
              {option.label}
            </button>
          )
        }}
      </For>
    </div>
  )
}

/** t3code's settings slider (kit.css): the value as a small pill, then a track filled to the thumb. */
export function Slider(props: { label: string; value: number; display: string; min: number; max: number; step?: number; disabled?: boolean; onChange: (value: number) => void }): JSX.Element {
  const fill = () => `${((props.value - props.min) / (props.max - props.min || 1)) * 100}%`
  return (
    <div class="flex w-56 max-w-full items-center gap-3" classList={{ "opacity-50": props.disabled }}>
      <output class="kit-value">{props.display}</output>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        aria-label={props.label}
        disabled={props.disabled}
        class="kit-range"
        style={{ "--fill": fill() }}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
      />
    </div>
  )
}

/** t3code's switch (kit.css). */
export function Toggle(props: { label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "on", "disabled", "onChange"])
  return (
    <button type="button" role="switch" aria-label={local.label} aria-checked={local.on} disabled={local.disabled} class="kit-switch" onClick={() => local.onChange(!local.on)} {...rest}>
      <span aria-hidden="true" />
    </button>
  )
}
