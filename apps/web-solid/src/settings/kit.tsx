import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, LoaderIcon, ResetIcon } from "@kiko/ui/icons"
import { For, Show, splitProps, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import "./kit.css"

const focus = "outline-none"

export const muted = "text-[var(--kit-meta)]"

export const line = "border-[color-mix(in_oklab,var(--foreground)_12%,transparent)]"

type Variant = "primary" | "secondary" | "ghost" | "danger"

export function buttonClass(variant: Variant = "secondary", extra?: string) {
  return cn("kit-btn", `kit-btn--${variant}`, extra)
}

export const selectClass = "kit-select"

export function Spinner(props: { size?: number }): JSX.Element {
  return <RemixIcon icon={LoaderIcon} class="motion-spin" size={props.size ?? 14} />
}

/** Placeholder bars while a load is in flight. Size them with `class`. */
export function Skeleton(props: { class?: string }): JSX.Element {
  return <div class={cn("motion-skeleton rounded-sm", props.class)} aria-hidden="true" data-component="skeleton" />
}

/** `busy` keeps the label's width and lays a spinner over it, so a button never changes size. */
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }): JSX.Element {
  const [local, rest] = splitProps(props, ["variant", "class", "type", "busy", "disabled", "children"])
  return (
    <button
      type={local.type ?? "button"}
      class={buttonClass(local.variant, cn(local.busy && "relative", local.class))}
      disabled={local.disabled || local.busy}
      aria-busy={local.busy || undefined}
      {...rest}
    >
      <Show when={local.busy} fallback={local.children}>
        <span class="invisible inline-flex items-center gap-[inherit]">{local.children}</span>
        <span class="motion-busy absolute inset-0 grid place-items-center">
          <Spinner />
        </span>
      </Show>
    </button>
  )
}

export const iconButtonClass = cn(
  "grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-[color-mix(in_oklab,var(--foreground)_60%,transparent)] enabled:hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] enabled:hover:text-foreground enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60",
  focus,
)

export function IconButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "danger", "class"])
  return (
    <button
      type="button"
      aria-label={local.label}
      title={local.label}
      class={cn(iconButtonClass, local.danger && "enabled:hover:bg-[color-mix(in_oklab,var(--error)_8%,transparent)] enabled:hover:text-[var(--error)]", local.class)}
      {...rest}
    />
  )
}

export function DetailsButton(props: { open: boolean; onToggle: () => void; label?: string; class?: string; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["open", "onToggle", "label", "class"])
  return (
    <button type="button" class={buttonClass("ghost", local.class)} aria-expanded={local.open} onClick={() => local.onToggle()} {...rest}>
      {local.label ?? (local.open ? "Hide details" : "Details")}
      <RemixIcon icon={ChevronDownIcon} class="size-3.5 shrink-0" classList={{ "rotate-180": local.open }} />
    </button>
  )
}

export const fieldClass = "kit-field"

export function Page(props: { title: string; description?: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="flex flex-col" data-component="settings-page">
      <header class="pb-5">
        <h1 class="font-display text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-foreground">{props.title}</h1>
        <Show when={props.description}>{(description) => <p class={cn("mt-1 max-w-xl text-md leading-relaxed", muted)}>{description()}</p>}</Show>
      </header>
      {props.children}
    </div>
  )
}

export function Group(props: { title?: JSX.Element; description?: JSX.Element; action?: JSX.Element; id?: string; bare?: boolean; class?: string; children?: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["title", "description", "action", "id", "bare", "class", "children"])
  return (
    <section class={local.class} data-setting-group={local.id} {...rest}>
      <Show when={local.title || local.action}>
        <div class="flex items-end gap-4 px-1 pb-2">
          <div class="min-w-0 flex-1">
            <Show when={local.title}>{(title) => <h2 class="text-sm font-semibold text-muted-foreground">{title()}</h2>}</Show>
            <Show when={local.description}>{(description) => <div class={cn("mt-0.5 text-sm leading-relaxed", muted)}>{description()}</div>}</Show>
          </div>
          <Show when={local.action}>{(action) => <div class="flex shrink-0 items-center gap-2 pb-0.5">{action()}</div>}</Show>
        </div>
      </Show>
      <Show when={!local.bare} fallback={local.children}>
        <div class="kit-card">{local.children}</div>
      </Show>
    </section>
  )
}

export const rowLine = "border-b border-[color-mix(in_oklab,var(--foreground)_6%,transparent)] last:border-b-0"

export function Row(props: { label: JSX.Element; description?: JSX.Element; id?: string; onReset?: () => void; details?: JSX.Element; class?: string; children?: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "description", "id", "onReset", "details", "class", "children"])
  return (
    <div class={cn("px-4", rowLine, local.class)} data-setting={local.id} {...rest}>
    <div class="settings-row flex items-center gap-6 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="flex min-h-5 items-center gap-1.5 text-md font-medium leading-5 text-foreground">
          {local.label}

          <Show when={local.onReset}>
            <button
              type="button"
              class={cn("relative grid size-5 cursor-pointer place-items-center rounded-md outline-none before:absolute before:-inset-1.5 hover:bg-[var(--accent)] hover:text-foreground", muted)}
              title="Reset to default"
              aria-label={`Reset ${typeof local.label === "string" ? local.label.toLowerCase() : "setting"} to default`}
              data-action="reset-setting"
              onClick={() => local.onReset!()}
            >
              <RemixIcon icon={ResetIcon} class="size-3" />
            </button>
          </Show>
        </div>
        <Show when={local.description}>{(description) => <div class={cn("mt-0.5 max-w-xl text-sm leading-normal", muted)}>{description()}</div>}</Show>
      </div>
      <Show when={local.children}>
        {(control) => <div class="settings-row-control flex min-w-0 max-w-[60%] shrink-0 flex-wrap items-center justify-end gap-2">{control()}</div>}
      </Show>
    </div>
    <Show when={local.details}>{(details) => <div class="pb-3.5">{details()}</div>}</Show>
    </div>
  )
}

export function Item(props: {
  icon?: JSX.Element
  title: JSX.Element
  meta?: JSX.Element
  trouble?: boolean
  actions?: JSX.Element
  children?: JSX.Element
  class?: string
  [data: `data-${string}`]: string | undefined
}): JSX.Element {
  const [local, rest] = splitProps(props, ["icon", "title", "meta", "trouble", "actions", "children", "class"])
  return (
    <div
      class={cn("grid items-center gap-x-3 px-4 py-2", local.icon ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]", rowLine, local.class)}
      {...rest}
    >
      <Show when={local.icon}>
        {(icon) => <span class="grid size-6 shrink-0 place-items-center overflow-hidden rounded-md bg-control text-muted-foreground">{icon()}</span>}
      </Show>
      <div class="flex min-h-7 min-w-0 flex-col justify-center">
        <div class="flex items-center gap-1.5 truncate text-md font-medium text-foreground">
          {local.title}
          <Show when={local.trouble}>
            <span class="size-1.5 shrink-0 rounded-full bg-[var(--error)]" aria-hidden="true" />
          </Show>
        </div>
        <Show when={local.meta}>{(meta) => <div class={cn("text-sm leading-snug", muted)}>{meta()}</div>}</Show>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">{local.actions}</div>
      <Show when={local.children}>{(body) => <div class={cn("col-span-2 min-w-0 pt-3 pb-1", local.icon && "col-start-2")}>{body()}</div>}</Show>
    </div>
  )
}

export function Hint(props: { children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  return (
    <p class={cn("text-md leading-relaxed", muted)} {...rest}>
      {local.children}
    </p>
  )
}

export function Empty(props: { children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  return (
    <div class={cn("px-4 py-3 text-md", muted, rowLine)} {...rest}>
      {local.children}
    </div>
  )
}

export function Notice(props: { tone?: "danger" | "muted"; children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["tone", "children"])
  return (
    <p role="alert" class={cn("text-sm leading-relaxed", local.tone === "muted" ? muted : "text-[color-mix(in_oklab,var(--error)_90%,transparent)]")} {...rest}>
      {local.children}
    </p>
  )
}

export function Pill(props: { tone?: "muted" | "accent" | "success" | "danger"; children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["tone", "children"])
  const tone = {
    muted: "bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] text-[color-mix(in_oklab,var(--foreground)_65%,transparent)]",
    accent: "bg-[color-mix(in_oklab,var(--ring)_16%,transparent)] text-[var(--ring)]",
    success: "bg-[color-mix(in_oklab,var(--success)_16%,transparent)] text-[var(--success)]",
    danger: "bg-[color-mix(in_oklab,var(--error)_14%,transparent)] text-[var(--error)]",
  }[local.tone ?? "muted"]
  return (
    <span class={cn("inline-flex h-[18px] shrink-0 items-center rounded-sm px-1.5 text-[11px] font-medium leading-none whitespace-nowrap", tone)} {...rest}>
      {local.children}
    </span>
  )
}

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

export function Toggle(props: { label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "on", "disabled", "onChange"])
  return (
    <button type="button" role="switch" aria-label={local.label} aria-checked={local.on} disabled={local.disabled} class="kit-switch motion-switch" onClick={() => local.onChange(!local.on)} {...rest}>
      <span aria-hidden="true" />
    </button>
  )
}

