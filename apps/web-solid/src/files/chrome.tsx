import { RemixIcon, type Glyph } from "@kiko/ui/remix-icon"
import { DownloadIcon, LoaderIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Show, type JSX } from "solid-js"

export const UNREADABLE = {
  binary: "This file contains binary data and cannot be shown as text.",
  "not-utf8": "This file is not UTF-8 text. Open it in another app to view its contents.",
} as const

export const SUBHEADER =
  "flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-[var(--stroke-tertiary)] px-3 in-data-[panel-mode=inline]:mb-3 in-data-[panel-mode=inline]:h-7 in-data-[panel-mode=inline]:min-h-7 in-data-[panel-mode=inline]:border-b-transparent"

export const ACTION =
  "grid size-7 shrink-0 place-items-center rounded-base text-[var(--text-tertiary)] transition-[background-color,color] duration-(--duration-fast) ease-sharp hover:bg-tertiary hover:text-primary aria-pressed:bg-secondary aria-pressed:text-primary disabled:opacity-50"

export function SurfaceAction(props: {
  label: string
  icon: Glyph
  action: string
  pressed?: boolean
  disabled?: boolean
  onPress?: () => void
  href?: string
  download?: string
}) {
  return (
    <TooltipV2 placement="bottom" openDelay={500} value={props.label}>
      <Show
        when={props.href}
        fallback={
          <button
            type="button"
            class={ACTION}
            aria-label={props.label}
            aria-pressed={props.pressed}
            disabled={props.disabled}
            data-action={props.action}
            onClick={() => props.onPress?.()}
          >
            <RemixIcon icon={props.icon} class="size-3.5" />
          </button>
        }
      >
        {(href) => (
          <a class={ACTION} href={href()} download={props.download} aria-label={props.label} data-action={props.action}>
            <RemixIcon icon={props.icon} class="size-3.5" />
          </a>
        )}
      </Show>
    </TooltipV2>
  )
}

export function SurfaceNotice(props: { children: JSX.Element }) {
  return (
    <div role="status" class="shrink-0 bg-editor px-3 py-1.5 text-xs text-secondary" data-component="file-notice">
      {props.children}
    </div>
  )
}

export function SurfaceLoading() {
  return (
    <div
      role="status"
      aria-label="Loading file"
      class="flex min-h-0 flex-1 items-center justify-center text-tertiary"
      data-component="file-loading"
    >
      <RemixIcon icon={LoaderIcon} size={20} class="motion-spin" />
    </div>
  )
}

export function SurfaceFailure(props: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs leading-relaxed"
      data-component="file-failure"
    >
      <p class="text-danger">{props.message}</p>
      <Show when={props.onRetry}>
        {(retry) => (
          <button
            type="button"
            class="rounded-base border border-[var(--stroke-tertiary)] px-2.5 py-1 text-xs text-primary hover:bg-tertiary"
            data-action="retry-file"
            onClick={() => retry()()}
          >
            Retry
          </button>
        )}
      </Show>
    </div>
  )
}

export function NoPreview(props: { name: string; href: string }) {
  const ext = () => (props.name.includes(".") ? `.${props.name.split(".").at(-1)}` : "this kind of")
  return (
    <div
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center"
      data-component="file-no-preview"
    >
      <p class="text-lg font-medium text-primary">No preview for this file</p>
      <p class="max-w-sm text-sm leading-relaxed text-tertiary">Save it to open in an app that supports {ext()} files.</p>
      <a
        class="mt-3 inline-flex h-7 items-center gap-1.5 rounded-base border border-[var(--stroke-tertiary)] px-2.5 text-xs text-primary hover:bg-tertiary"
        href={props.href}
        download={props.name}
        data-action="download"
      >
        <RemixIcon icon={DownloadIcon} size={16} />
        Save file
      </a>
    </div>
  )
}
