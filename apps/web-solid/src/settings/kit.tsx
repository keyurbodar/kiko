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
const focus = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]"

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
  "grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-[color-mix(in_oklab,var(--text)_60%,transparent)] hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)] hover:text-text active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60",
  focus,
)

export function IconButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "danger", "class"])
  return (
    <button
      type="button"
      aria-label={local.label}
      title={local.label}
      class={cn(iconButtonClass, local.danger && "hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] hover:text-[var(--danger)]", local.class)}
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

/** The mark of a choice in a list: an empty ring, filled when chosen. Drawn on every choice. */
export function Radio(props: { on: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class="grid size-4 shrink-0 place-items-center rounded-full border"
      classList={{
        "border-[var(--accent-fill)] bg-[var(--accent-fill)]": props.on,
        "border-[color-mix(in_oklab,var(--text)_25%,transparent)]": !props.on,
      }}
    >
      <Show when={props.on}>
        <span class="size-1.5 rounded-full bg-[var(--on-accent)]" />
      </Show>
    </span>
  )
}

/** The class of a choice row: the whole row is the button, it says so with a radio and a hover fill. */
export const choiceRowClass = cn(
  "flex w-full cursor-pointer items-center gap-3 px-4 text-left hover:bg-[color-mix(in_oklab,var(--text)_4%,transparent)] aria-selected:bg-[color-mix(in_oklab,var(--text)_4%,transparent)] aria-[current=true]:bg-[color-mix(in_oklab,var(--text)_4%,transparent)]",
  "outline-none focus-visible:bg-[color-mix(in_oklab,var(--text)_6%,transparent)]",
)

/** t3code's input (kit.css): 30px, 8px corners, bevelled, a ring on focus. */
export const fieldClass = "kit-field"

/** monocode's PageHeader, then the page's groups. */
export function Page(props: { title: string; description?: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="flex flex-col" data-component="settings-page">
      <header class="pb-4">
        <h1 class="text-[20px] font-semibold leading-tight text-text">{props.title}</h1>
        <Show when={props.description}>
          <p class="mt-1.5 max-w-xl text-[13px] leading-relaxed text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{props.description}</p>
        </Show>
      </header>
      {props.children}
    </div>
  )
}

/** A titled card of rows, t3code's settings group: a quiet heading over a 14px-cornered card. A page spaces its groups 32px apart. `bare` drops the card. */
export function Group(props: { title?: string; description?: JSX.Element; action?: JSX.Element; id?: string; bare?: boolean; class?: string; children: JSX.Element }): JSX.Element {
  return (
    <section class={props.class} data-setting-group={props.id}>
      <Show when={props.title || props.action}>
        <div class="flex items-end gap-4 px-1 pb-2.5">
          <div class="min-w-0 flex-1">
            <Show when={props.title}>
              <h2 class="text-[14px] font-normal text-[color-mix(in_oklab,var(--text)_70%,transparent)]">{props.title}</h2>
            </Show>
            <Show when={props.description}>
              <div class="mt-1 text-[12px] leading-relaxed text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{props.description}</div>
            </Show>
          </div>
          <Show when={props.action}>
            <div class="flex shrink-0 items-center gap-2 pb-0.5">{props.action}</div>
          </Show>
        </div>
      </Show>
      <Show when={!props.bare} fallback={props.children}>
        <div class="kit-card">{props.children}</div>
      </Show>
    </section>
  )
}

/** The hairline under each row of a card, gone under the last: monocode's `border-b border-content/5 last:border-b-0`. */
export const rowLine = "border-b border-[color-mix(in_oklab,var(--text)_6%,transparent)] last:border-b-0"

/** t3code's settings row: a 14px label and a muted line on the left, the control on the right. Stacks in a narrow pane (kit.css). */
export function Row(props: { label: JSX.Element; description?: JSX.Element; id?: string; onReset?: () => void; children?: JSX.Element }): JSX.Element {
  return (
    <div class={cn("settings-row flex items-center gap-8 px-4 py-3", rowLine)} data-setting={props.id}>
      <div class="min-w-0 flex-1">
        <div class="flex min-h-5 items-center gap-1.5 text-[14px] font-medium leading-5 text-text">
          {props.label}
          {/* t3code's reset: shown only while the setting differs from its default. */}
          <Show when={props.onReset}>
            <button
              type="button"
              class="grid size-5 cursor-pointer place-items-center rounded-md text-[color-mix(in_oklab,var(--text)_45%,transparent)] outline-none hover:bg-[var(--kit-hover)] hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              title="Reset to default"
              aria-label={`Reset ${typeof props.label === "string" ? props.label.toLowerCase() : "setting"} to default`}
              data-action="reset-setting"
              onClick={() => props.onReset!()}
            >
              <svg class="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
                <path d="M2.5 2.5v3h3" />
              </svg>
            </button>
          </Show>
        </div>
        <Show when={props.description}>
          <div class="mt-0.5 max-w-xl text-[12px] leading-normal text-[color-mix(in_oklab,var(--text)_50%,transparent)]">{props.description}</div>
        </Show>
      </div>
      <Show when={props.children}>
        <div class="settings-row-control flex min-w-0 max-w-[60%] shrink-0 flex-wrap items-center justify-end gap-2">{props.children}</div>
      </Show>
    </div>
  )
}

/** A thing in a list, monocode's MCP and account rows: an icon tile, a name, a muted line, and its actions. */
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
    <div class={cn("flex flex-col", rowLine, local.class)} {...rest}>
      <div class="flex min-h-12 items-center gap-3 px-4 py-2.5">
        <Show when={local.icon}>
          <span class="grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-[color-mix(in_oklab,var(--text)_5%,transparent)] text-[color-mix(in_oklab,var(--text)_60%,transparent)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--text)_6%,transparent)]">
            {local.icon}
          </span>
        </Show>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 truncate text-[13px] font-medium text-text">
            {local.title}
            <Show when={local.trouble}>
              <span class="size-1.5 shrink-0 rounded-full bg-[var(--danger)]" aria-hidden="true" />
            </Show>
          </div>
          <Show when={local.meta}>
            <div class="mt-0.5 truncate text-[12px] text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{local.meta}</div>
          </Show>
        </div>
        <Show when={local.actions}>
          <div class="flex shrink-0 items-center gap-1.5">{local.actions}</div>
        </Show>
      </div>
      <Show when={local.children}>
        <div class="px-4 pb-3.5">{local.children}</div>
      </Show>
    </div>
  )
}

/** A plain muted sentence with no box: an empty list, a loading list. A box around one line is noise. */
export function Hint(props: { children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  return (
    <p class="text-[13px] leading-relaxed text-[color-mix(in_oklab,var(--text)_50%,transparent)]" {...rest}>
      {local.children}
    </p>
  )
}

/** A compact 40px row for a long catalog: a small icon, the name, a muted count on the right, the action. */
export function ListRow(props: { icon?: JSX.Element; title: JSX.Element; meta?: JSX.Element; actions?: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["icon", "title", "meta", "actions"])
  return (
    <div class={cn("flex h-10 items-center gap-3 pr-2 pl-4", rowLine)} {...rest}>
      <Show when={local.icon}>
        <span class="grid size-4 shrink-0 place-items-center text-[color-mix(in_oklab,var(--text)_60%,transparent)]">{local.icon}</span>
      </Show>
      <span class="min-w-0 flex-1 truncate text-[13px] text-text">{local.title}</span>
      <Show when={local.meta}>
        <span class="shrink-0 text-[12px] tabular-nums text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{local.meta}</span>
      </Show>
      <Show when={local.actions}>
        <div class="flex shrink-0 items-center gap-1.5">{local.actions}</div>
      </Show>
    </div>
  )
}

/** One muted line inside a card, monocode's empty state: "No MCP servers configured." */
export function Empty(props: { children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  return (
    <div class={cn("px-4 py-3.5 text-[13px] text-[color-mix(in_oklab,var(--text)_55%,transparent)]", rowLine)} {...rest}>
      {local.children}
    </div>
  )
}

/** An error as a line, not a panel: monocode's `text-[12px] text-red-400/90`. */
export function Notice(props: { tone?: "danger" | "muted"; children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["tone", "children"])
  return (
    <p
      role="alert"
      class={cn("text-[12px] leading-relaxed", local.tone === "muted" ? "text-[color-mix(in_oklab,var(--text)_45%,transparent)]" : "text-[color-mix(in_oklab,var(--danger)_90%,transparent)]")}
      {...rest}
    >
      {local.children}
    </p>
  )
}

/** monocode's "default" pill. */
export function Pill(props: { tone?: "muted" | "accent" | "danger"; children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["tone", "children"])
  const tone = {
    muted: "bg-[color-mix(in_oklab,var(--text)_10%,transparent)] text-[color-mix(in_oklab,var(--text)_60%,transparent)]",
    accent: "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent)]",
    danger: "bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] text-[var(--danger)]",
  }[local.tone ?? "muted"]
  return (
    <span class={cn("inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none", tone)} {...rest}>
      {local.children}
    </span>
  )
}

/** t3code's segmented toggle group (kit.css). */
export function Segmented<T extends string>(props: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }): JSX.Element {
  return (
    <div role="radiogroup" aria-label={props.label} class="kit-seg" style={{ "grid-template-columns": `repeat(${props.options.length}, minmax(0, 1fr))` }}>
      <For each={props.options}>
        {(option) => (
          <button type="button" role="radio" aria-checked={props.value === option.value} data-value={option.value} class="kit-seg-item" onClick={() => props.onChange(option.value)}>
            {option.label}
          </button>
        )}
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
