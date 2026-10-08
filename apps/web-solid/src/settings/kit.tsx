// The settings kit: every settings page is built from these, after monocode's settings view (MIT,
// src/features/settings/ui/SettingsView.tsx) and t3code's settings layout (MIT,
// apps/web/src/components/settings/settingsLayout.tsx). A page is a header, then titled groups;
// a group is one card of rows split by hairlines; a row is a label with a short description and
// its control on the right. Lists (providers, extensions, tools) are item rows in the same card.
import { For, Show, splitProps, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import "./kit.css"

// `color-mix(in_oklab,var(--text)_N%,transparent)` below is monocode's `content/N`.
const focus = "outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent)]"

/** Hairline shared by every card, field, and quiet button: monocode's `border-content/10`. */
export const line = "border-[color-mix(in_oklab,var(--text)_10%,transparent)]"

type Variant = "primary" | "secondary" | "ghost" | "danger"

// monocode's SecondaryButton (shared/ui/SecondaryButton.tsx), its solid "use" button
// (SettingsView.tsx), and its quiet icon button, with kiko's danger color for its red-400.
const VARIANTS: Record<Variant, string> = {
  primary: "h-6 rounded-[4.5px] bg-text px-2.5 text-[11px] font-medium text-[var(--bg)] hover:bg-[color-mix(in_oklab,var(--text)_85%,transparent)] active:scale-[0.97]",
  secondary: "rounded-md border border-[color-mix(in_oklab,var(--text)_10%,transparent)] px-2.5 py-1 text-[12px] text-[color-mix(in_oklab,var(--text)_70%,transparent)] hover:bg-[color-mix(in_oklab,var(--text)_10%,transparent)] hover:text-text",
  ghost: "rounded-md px-2.5 py-1 text-[12px] text-[color-mix(in_oklab,var(--text)_50%,transparent)] hover:bg-[color-mix(in_oklab,var(--text)_10%,transparent)] hover:text-text",
  danger: "rounded-md border border-[color-mix(in_oklab,var(--text)_10%,transparent)] px-2.5 py-1 text-[12px] text-[var(--danger)] hover:border-[color-mix(in_oklab,var(--danger)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]",
}

/** The class of a settings button, for an element that cannot be a `Button` (a link, a label). */
export function buttonClass(variant: Variant = "secondary", extra?: string) {
  return cn(
    "flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap",
    "disabled:cursor-default disabled:opacity-40",
    focus,
    VARIANTS[variant],
    extra,
  )
}

export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }): JSX.Element {
  const [local, rest] = splitProps(props, ["variant", "class", "type"])
  return <button type={local.type ?? "button"} class={buttonClass(local.variant, local.class)} {...rest} />
}

export const iconButtonClass = cn(
  "grid size-7 shrink-0 place-items-center rounded-md text-[color-mix(in_oklab,var(--text)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--text)_10%,transparent)] hover:text-text active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40",
  focus,
)

export function IconButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "danger", "class"])
  return (
    <button
      type="button"
      aria-label={local.label}
      title={local.label}
      class={cn(iconButtonClass, local.danger && "hover:bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] hover:text-[var(--danger)]", local.class)}
      {...rest}
    />
  )
}

/** monocode's settings field: 28px, 6px corners, the hairline, a 5% fill. */
export const fieldClass = cn(
  "h-7 min-w-0 rounded-md border bg-[color-mix(in_oklab,var(--text)_5%,transparent)] px-2 text-[12px] text-text placeholder:text-[color-mix(in_oklab,var(--text)_35%,transparent)]",
  line,
  "outline-none focus:border-[color-mix(in_oklab,var(--text)_20%,transparent)]",
)

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

/** monocode's Group: a titled card of rows. A page spaces its groups 32px apart. `bare` drops the card. */
export function Group(props: { title?: string; description?: JSX.Element; action?: JSX.Element; id?: string; bare?: boolean; class?: string; children: JSX.Element }): JSX.Element {
  return (
    <section class={props.class} data-setting-group={props.id}>
      <Show when={props.title || props.action}>
        <div class="flex items-end gap-4 pb-2.5">
          <div class="min-w-0 flex-1">
            <Show when={props.title}>
              <h2 class="text-[13px] font-semibold text-text">{props.title}</h2>
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
        <div class="overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--text)_10%,transparent)] bg-[color-mix(in_oklab,var(--text)_3%,transparent)]">{props.children}</div>
      </Show>
    </section>
  )
}

/** The hairline under each row of a card, gone under the last: monocode's `border-b border-content/5 last:border-b-0`. */
export const rowLine = "border-b border-[color-mix(in_oklab,var(--text)_5%,transparent)] last:border-b-0"

/** monocode's Row: label and description on the left, the control on the right, top-aligned. Stacks in a narrow pane (kit.css). */
export function Row(props: { label: JSX.Element; description?: JSX.Element; id?: string; children?: JSX.Element }): JSX.Element {
  return (
    <div class={cn("settings-row flex items-start gap-6 px-4 py-3.5", rowLine)} data-setting={props.id}>
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-medium text-text">{props.label}</div>
        <Show when={props.description}>
          <div class="mt-1 text-[12px] leading-relaxed text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{props.description}</div>
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

/** monocode's "default" pill, lowercase. */
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

/** monocode's Segmented. */
export function Segmented<T extends string>(props: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      class="inline-grid max-w-full shrink-0 gap-0.5 rounded-md border border-[color-mix(in_oklab,var(--text)_10%,transparent)] p-0.5 text-[12px]"
      style={{ "grid-template-columns": `repeat(${props.options.length}, minmax(0, 1fr))` }}
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === option.value}
            data-value={option.value}
            class={cn(
              "min-w-0 truncate rounded-[5px] px-2.5 py-1 text-[color-mix(in_oklab,var(--text)_50%,transparent)] hover:text-text aria-checked:bg-[var(--selected-bg)] aria-checked:text-text",
              focus,
            )}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

/** monocode's Slider: a 4px track and a 12px thumb (kit.css). */
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
        class="kit-range min-w-0 flex-1 disabled:cursor-not-allowed"
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <span class="w-10 shrink-0 text-right text-[12px] tabular-nums text-text">{props.display}</span>
    </div>
  )
}

/** monocode's Toggle. */
export function Toggle(props: { label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "on", "disabled", "onChange"])
  return (
    <button
      type="button"
      role="switch"
      aria-label={local.label}
      aria-checked={local.on}
      disabled={local.disabled}
      class={cn("relative h-5 w-9 shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-40", focus)}
      classList={{ "bg-[var(--accent)]": local.on, "bg-[color-mix(in_oklab,var(--text)_20%,transparent)]": !local.on }}
      onClick={() => local.onChange(!local.on)}
      {...rest}
    >
      <span class="absolute top-0.5 size-4 rounded-full bg-white" classList={{ "left-[18px]": local.on, "left-0.5": !local.on }} />
    </button>
  )
}
