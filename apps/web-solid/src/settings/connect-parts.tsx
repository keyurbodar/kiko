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
        "grid shrink-0 place-items-center overflow-hidden rounded-tile bg-[var(--fill-field)] text-[var(--text-200)]",
        props.size === "head" ? "size-10" : "size-8",
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
      <Show when={props.hint}>{(hint) => <p class="min-w-0 type-label text-[var(--text-300)]">{hint()}</p>}</Show>
    </div>
  )
}

export function OrDivider(props: { children: JSX.Element }): JSX.Element {
  return (
    <div class="flex items-center gap-3 type-hint text-[var(--text-400)]" role="separator">
      <span class="h-px flex-1 bg-line2" />
      {props.children}
      <span class="h-px flex-1 bg-line2" />
    </div>
  )
}

export function KeyLink(props: { href: string; children?: JSX.Element }): JSX.Element {
  return (
    <a
      class="link-grow inline-flex w-fit items-center gap-1 type-label text-fg2 hover:text-fg"
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
      <label class="type-label text-[var(--text-300)]" for={props.id}>
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
          class="absolute right-1 grid size-7 cursor-pointer place-items-center rounded-control text-[var(--text-300)] transition-colors duration-(--dur-hover) hover:bg-[var(--fill-hover)] hover:text-fg aria-pressed:text-fg"
          aria-label={shown() ? "Hide key" : "Show key"}
          aria-pressed={shown()}
          onClick={() => setShown(!shown())}
        >
          <RemixIcon icon={EyeIcon} size={16} />
        </button>
      </div>
      <Show when={props.error}>
        {(error) => (
          <p
            id={`${props.id}-error`}
            class="type-label text-[var(--danger)]"
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
