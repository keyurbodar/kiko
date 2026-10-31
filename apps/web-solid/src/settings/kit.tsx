import { RemixIcon, type IconSize } from "@kiko/ui/remix-icon"
import { LoaderIcon } from "@kiko/ui/icons"
import { Pictogram, type PictogramName } from "@kiko/ui/pictogram"
import { For, Show, splitProps, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import "./kit.css"

export const muted = "text-[var(--kit-meta)]"

type Variant = "primary" | "secondary" | "ghost" | "outline" | "accent" | "danger"
type Tone = "accent" | "danger" | "success" | "warning"
type Size = "sm" | "md" | "lg" | "xl"

export function buttonClass(variant: Variant = "secondary", extra?: string, size: Size = "md", tone?: Tone) {
  return cn("kit-btn", `kit-btn--${variant}`, size !== "md" && `kit-btn--${size}`, tone && `kit-tone--${tone}`, extra)
}

export const selectClass = "kit-select"

export function Spinner(props: { size?: IconSize }): JSX.Element {
  return (
    <RemixIcon
      icon={LoaderIcon}
      class="kit-spinner"
      size={props.size ?? 14}
      style={{ "--spinner-sync": `${-(performance.now() % 1000)}ms` }}
      data-component="spinner"
    />
  )
}

export function Kbd(props: { keys: readonly string[]; size?: "sm" | "md" }): JSX.Element {
  return (
    <span class="kit-kbd" data-size={props.size ?? "md"} data-component="kbd">
      <For each={props.keys}>{(key) => <kbd data-wide={key.length > 1 || undefined}>{key}</kbd>}</For>
    </span>
  )
}

export function Skeleton(props: { class?: string }): JSX.Element {
  return <div class={cn("motion-skeleton rounded-base", props.class)} aria-hidden="true" data-component="skeleton" />
}

export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; tone?: Tone; size?: Size; busy?: boolean },
): JSX.Element {
  const [local, rest] = splitProps(props, ["variant", "tone", "size", "class", "type", "busy", "disabled", "children"])
  return (
    <button
      type={local.type ?? "button"}
      class={buttonClass(local.variant, cn(local.busy && "relative", local.class), local.size, local.tone)}
      disabled={local.disabled || local.busy}
      aria-busy={local.busy || undefined}
      {...rest}
    >
      <Show when={local.busy} fallback={local.children}>
        <span class="invisible inline-flex items-center gap-[inherit]">{local.children}</span>
        <span class="motion-busy absolute inset-0 grid place-items-center">
          <Spinner size={12} />
        </span>
      </Show>
    </button>
  )
}

export const iconButtonClass = "kit-icon-btn"

export function IconButton(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean; size?: Size },
): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "danger", "size", "class"])
  return (
    <button
      type="button"
      aria-label={local.label}
      title={local.label}
      class={cn(
        iconButtonClass,
        local.size && local.size !== "md" && `kit-icon-btn--${local.size}`,
        local.danger && "kit-tone--danger",
        local.class,
      )}
      {...rest}
    />
  )
}

export const fieldClass = "kit-field"

export function Page(props: { title: string; description?: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="flex flex-col" data-component="settings-page">
      <header class="pb-5">
        <h1 class="settings-page-title">{props.title}</h1>
        <Show when={props.description}>
          {(description) => <p class="mt-1 max-w-xl type-base text-tertiary">{description()}</p>}
        </Show>
      </header>
      {props.children}
    </div>
  )
}

export function Group(props: {
  title?: JSX.Element
  description?: JSX.Element
  action?: JSX.Element
  id?: string
  bare?: boolean
  class?: string
  children?: JSX.Element
  [data: `data-${string}`]: string | undefined
}): JSX.Element {
  const [local, rest] = splitProps(props, ["title", "description", "action", "id", "bare", "class", "children"])
  return (
    <section class={local.class} data-setting-group={local.id} {...rest}>
      <Show when={local.title || local.action}>
        <div class="flex items-end gap-4 px-0.5 pb-2">
          <div class="min-w-0 flex-1">
            <Show when={local.title}>
              {(title) => <h2 class="flex min-h-6 items-center type-sm text-tertiary">{title()}</h2>}
            </Show>
            <Show when={local.description}>
              {(description) => <div class={cn("type-sm", muted)}>{description()}</div>}
            </Show>
          </div>
          <Show when={local.action}>
            {(action) => <div class="flex shrink-0 items-center gap-1.5">{action()}</div>}
          </Show>
        </div>
      </Show>
      <Show when={!local.bare} fallback={local.children}>
        <div class="kit-card">{local.children}</div>
      </Show>
    </section>
  )
}

const rowLine = "shadow-[inset_0_-1px_0_var(--stroke-tertiary)] last:shadow-none"

export function Row(props: {
  label: JSX.Element
  description?: JSX.Element
  id?: string
  onReset?: () => void
  details?: JSX.Element
  class?: string
  children?: JSX.Element
  [data: `data-${string}`]: string | undefined
}): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "description", "id", "onReset", "details", "class", "children"])
  return (
    <div class={cn("px-3", rowLine, local.class)} data-setting={local.id} {...rest}>
      <div class="settings-row flex min-h-12 items-center gap-6 py-2.5">
        <div class="min-w-0 flex-1">
          <div class="flex min-h-5 items-center gap-1.5 type-base text-primary">
            {local.label}

            <Show when={local.onReset}>
              <button
                type="button"
                class="kit-icon-btn kit-icon-btn--sm relative before:absolute before:-inset-1"
                title="Reset to default"
                aria-label={`Reset ${typeof local.label === "string" ? local.label.toLowerCase() : "setting"} to default`}
                data-action="reset-setting"
                onClick={() => local.onReset!()}
              >
                <svg
                  class="size-3"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
                  <path d="M2.5 2.5v3h3" />
                </svg>
              </button>
            </Show>
          </div>
          <Show when={local.description}>
            {(description) => <div class={cn("mt-0.5 max-w-xl type-sm", muted)}>{description()}</div>}
          </Show>
        </div>
        <Show when={local.children}>
          {(control) => (
            <div class="settings-row-control flex min-w-0 max-w-[60%] shrink-0 flex-wrap items-center justify-end gap-1.5">
              {control()}
            </div>
          )}
        </Show>
      </div>
      <Show when={local.details}>{(details) => <div class="pb-3">{details()}</div>}</Show>
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
      class={cn(
        "grid items-center gap-x-2.5 px-3 py-2",
        local.icon ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]",
        rowLine,
        local.class,
      )}
      {...rest}
    >
      <Show when={local.icon}>
        {(icon) => (
          <span class="grid size-6 shrink-0 place-items-center overflow-hidden rounded-base bg-tertiary icon-secondary">
            {icon()}
          </span>
        )}
      </Show>
      <div class="flex min-h-7 min-w-0 flex-col justify-center">
        <div class="flex items-center gap-1.5 truncate type-base text-primary">
          {local.title}
          <Show when={local.trouble}>
            <span class="size-1.5 shrink-0 rounded-full bg-[var(--text-danger)]" aria-hidden="true" />
          </Show>
        </div>
        <Show when={local.meta}>{(meta) => <div class={cn("truncate type-sm", muted)}>{meta()}</div>}</Show>
      </div>
      <div class="flex shrink-0 items-center gap-1">{local.actions}</div>
      <Show when={local.children}>
        {(body) => <div class={cn("col-span-2 min-w-0 pt-2.5 pb-1", local.icon && "col-start-2")}>{body()}</div>}
      </Show>
    </div>
  )
}

export function Hint(props: { children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  return (
    <p class={cn("type-sm", muted)} {...rest}>
      {local.children}
    </p>
  )
}

export function Empty(props: { children: JSX.Element; [data: `data-${string}`]: string | undefined }): JSX.Element {
  const [local, rest] = splitProps(props, ["children"])
  return (
    <div class={cn("px-3 py-3 type-base", muted, rowLine)} {...rest}>
      {local.children}
    </div>
  )
}

export function EmptyState(props: {
  art: PictogramName
  title: string
  line?: string
  action?: JSX.Element
  [data: `data-${string}`]: string | undefined
}): JSX.Element {
  const [local, rest] = splitProps(props, ["art", "title", "line", "action"])
  return (
    <div class="kit-empty" {...rest}>
      <span class="kit-empty-tile">
        <Pictogram name={local.art} size={56} />
      </span>
      <p class="kit-empty-title">{local.title}</p>
      <Show when={local.line}>{(line) => <p class="kit-empty-line">{line()}</p>}</Show>
      <Show when={local.action}>{(action) => <div class="kit-empty-action">{action()}</div>}</Show>
    </div>
  )
}

export function Notice(props: {
  tone?: "danger" | "muted"
  children: JSX.Element
  [data: `data-${string}`]: string | undefined
}): JSX.Element {
  const [local, rest] = splitProps(props, ["tone", "children"])
  return (
    <p role="alert" class={cn("type-sm", local.tone === "muted" ? muted : "text-danger")} {...rest}>
      {local.children}
    </p>
  )
}

export function Slider(props: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step?: number
  disabled?: boolean
  onInput?: (value: number) => void
  onChange: (value: number) => void
}): JSX.Element {
  const fill = () => `${((props.value - props.min) / (props.max - props.min || 1)) * 100}%`
  return (
    <div
      class="flex w-48 max-w-full items-center gap-2.5"
      classList={{ "opacity-(--opacity-disabled)": props.disabled }}
    >
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
        onInput={(e) => (props.onInput ?? props.onChange)(Number(e.currentTarget.value))}
        onChange={(e) => props.onChange(Number(e.currentTarget.value))}
      />
    </div>
  )
}

export function Toggle(props: {
  label: string
  on: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
  [data: `data-${string}`]: string | undefined
}): JSX.Element {
  const [local, rest] = splitProps(props, ["label", "on", "disabled", "onChange"])
  return (
    <button
      type="button"
      role="switch"
      aria-label={local.label}
      aria-checked={local.on}
      disabled={local.disabled}
      class="kit-switch motion-switch"
      onClick={() => local.onChange(!local.on)}
      {...rest}
    >
      <span aria-hidden="true" />
    </button>
  )
}
