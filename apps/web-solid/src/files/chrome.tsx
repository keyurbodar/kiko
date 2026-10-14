import { HugeIcon, type Glyph } from "@kiko/ui/huge-icon"
import { DownloadIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Show, type JSX } from "solid-js"

export const UNREADABLE = {
	binary: "This file contains binary data and cannot be shown as text.",
	"not-utf8": "This file is not UTF-8 text. Open it in another app to view its contents.",
} as const

export const SUBHEADER = "flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3"

const ACTION =
	"grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:bg-accent-strong aria-pressed:text-foreground disabled:opacity-50"

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
		<TooltipV2 placement="bottom" openDelay={400} value={props.label}>
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
						<HugeIcon icon={props.icon} size={14} />
					</button>
				}
			>
				{(href) => (
					<a class={ACTION} href={href()} download={props.download} aria-label={props.label} data-action={props.action}>
						<HugeIcon icon={props.icon} size={14} />
					</a>
				)}
			</Show>
		</TooltipV2>
	)
}

export function SurfaceNotice(props: { children: JSX.Element }) {
	return (
		<div role="status" class="shrink-0 border-b border-[color-mix(in_oklab,var(--warning)_35%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-3 py-1.5 text-xs text-warning" data-component="file-notice">
			{props.children}
		</div>
	)
}

export function SurfaceLoading() {
	return (
		<div role="status" class="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground" data-component="file-loading">
			Loading file
		</div>
	)
}

export function SurfaceFailure(props: { message: string; onRetry?: () => void }) {
	return (
		<div role="alert" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs leading-relaxed" data-component="file-failure">
			<p class="text-error">{props.message}</p>
			<Show when={props.onRetry}>
				{(retry) => (
					<button
						type="button"
						class="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-foreground hover:bg-accent"
						data-action="retry-file"
						onClick={() => retry()()}
					>
						Try again
					</button>
				)}
			</Show>
		</div>
	)
}

export function NoPreview(props: { name: string; href: string }) {
	const ext = () => (props.name.includes(".") ? `.${props.name.split(".").at(-1)}` : "this kind of")
	return (
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center" data-component="file-no-preview">
			<p class="text-base font-medium text-foreground">No preview for this file</p>
			<p class="max-w-sm text-sm leading-relaxed text-muted-foreground">Save it to open in an app that supports {ext()} files.</p>
			<a
				class="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-xs text-foreground hover:bg-accent"
				href={props.href}
				download={props.name}
				data-action="download"
			>
				<HugeIcon icon={DownloadIcon} size={14} />
				Save file
			</a>
		</div>
	)
}
