import { RemixIcon } from "@kiko/ui/remix-icon"
import { ExternalIcon, EyeIcon } from "@kiko/ui/icons"
import { createSignal, Show, type JSX } from "solid-js"
import { cn } from "../lib/cn"
import { SECRET_FIELD } from "../lib/secret-field"
import { fieldClass } from "./kit"

export function BrandTile(props: { children: JSX.Element; size?: "row" | "head" }): JSX.Element {
  return (
    <span
      class={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-tertiary icon-secondary",
        props.size === "head" ? "size-10 rounded-xl" : "size-7 rounded-lg",
      )}
      aria-hidden="true"
    >
      {props.children}
    </span>
  )
}

export function ConnectHead(props: { icon: JSX.Element; hint?: JSX.Element }): JSX.Element {
  return (
    <div class="flex items-center gap-3 pb-1" data-component="connect-head">
      <BrandTile size="head">{props.icon}</BrandTile>
      <Show when={props.hint}>{(hint) => <p class="min-w-0 type-sm text-[var(--text-tertiary)]">{hint()}</p>}</Show>
    </div>
  )
}

export function OrDivider(props: { children: JSX.Element }): JSX.Element {
  return (
    <div class="flex items-center gap-3 type-xs text-[var(--text-quaternary)]" role="separator">
      <span class="h-px flex-1 bg-secondary" />
      {props.children}
      <span class="h-px flex-1 bg-secondary" />
    </div>
  )
}

export function KeyLink(props: { href: string; children?: JSX.Element }): JSX.Element {
  return (
    <a
      class="link-grow inline-flex w-fit items-center gap-1 type-sm text-secondary hover:text-primary"
      href={props.href}
      target="_blank"
      rel="noreferrer"
      data-component="key-link"
    >
      {props.children ?? "Get a key"}
      <RemixIcon icon={ExternalIcon} size={12} />
    </a>
  )
}

export function SecretInput(props: {
  id: string
  label: string
  placeholder?: string
  ref?: (el: HTMLInputElement) => void
  error?: string | null
  autofocus?: boolean
  name?: string
  "data-component"?: string
}): JSX.Element {
  const [shown, setShown] = createSignal(false)
  return (
    <div class="flex flex-col gap-1.5">
      <label class="type-sm text-[var(--text-tertiary)]" for={props.id}>
        {props.label}
      </label>
      <div class="relative flex items-center">
        <input
          id={props.id}
          ref={props.ref}
          {...SECRET_FIELD}
          style={shown() ? {} : SECRET_FIELD.style}
          name={props.name ?? `kiko-${props.id}-secret`}
          placeholder={props.placeholder}
          autofocus={props.autofocus}
          aria-invalid={props.error ? "true" : undefined}
          aria-describedby={props.error ? `${props.id}-error` : undefined}
          class={cn(fieldClass, "w-full pr-10 font-mono placeholder:font-sans")}
          data-component={props["data-component"]}
        />
        <button
          type="button"
          class="absolute right-1 grid size-6 cursor-pointer place-items-center rounded-base icon-secondary transition-colors duration-(--duration-fast) hover:bg-tertiary hover:icon-primary aria-pressed:icon-primary"
          aria-label={shown() ? "Hide key" : "Show key"}
          aria-pressed={shown()}
          onClick={() => setShown(!shown())}
        >
          <RemixIcon icon={EyeIcon} size={13} />
        </button>
      </div>
      <Show when={props.error}>
        {(error) => (
          <p
            id={`${props.id}-error`}
            class="type-sm text-[var(--text-danger)]"
            role="alert"
            data-component="connect-error"
          >
            {error()}
          </p>
        )}
      </Show>
    </div>
  )
}
