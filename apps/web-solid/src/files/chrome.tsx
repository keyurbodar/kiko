import { HugeIcon, type Glyph } from "@kiko/ui/huge-icon"
import { DownloadIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { Show, type JSX } from "solid-js"

/*
 * The chrome every file surface in the panel shares, after t3code's fileSurfaceChrome: one header
 * row, icon actions with their label in a tooltip, a notice bar, and one way to say loading,
 * failed, or nothing to show. Viewers draw their body and use these for the rest.
 */

/** What a text view says when the bytes are not text it can show. */
export const UNREADABLE = {
	binary: "This file contains binary data and cannot be shown as text.",
	"not-utf8": "This file is not UTF-8 text. Open it in another app to view its contents.",
} as const

/** The row under the tabs: crumbs on the left, actions on the right. */
export const SUBHEADER = "flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-[var(--panel-edge)] px-3"

const ACTION =
	"grid size-7 shrink-0 place-items-center rounded-md text-muted outline-none hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-[var(--accent)] aria-pressed:bg-selected aria-pressed:text-text disabled:opacity-50"

/**
 * An icon action. A `pressed` action is a toggle and says so; a command is a plain button. With
 * `href` it is a link that saves the file.
 */
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

/** A one-line note over the body, such as a preview cut at 1 MB. */
export function SurfaceNotice(props: { children: JSX.Element }) {
	return (
		<div role="status" class="shrink-0 border-b border-v2-state-border-warning bg-v2-state-bg-warning px-3 py-1.5 text-xs text-v2-state-fg-warning" data-component="file-notice">
			{props.children}
		</div>
	)
}

export function SurfaceLoading() {
	return (
		<div role="status" aria-label="Loading file" class="flex min-h-0 flex-1 items-center justify-center text-muted" data-component="file-loading">
			<span class="motion-spin size-5 rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
		</div>
	)
}

export function SurfaceFailure(props: { message: string; onRetry?: () => void }) {
	return (
		<div role="alert" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs leading-relaxed" data-component="file-failure">
			<p class="text-danger">{props.message}</p>
			<Show when={props.onRetry}>
				{(retry) => (
					<button
						type="button"
						class="rounded-md border border-[var(--panel-edge)] px-2.5 py-1 text-xs text-text hover:bg-hover focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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

/** A file kiko cannot draw: what it is, and the way to open it elsewhere. */
export function NoPreview(props: { name: string; href: string }) {
	const ext = () => (props.name.includes(".") ? `.${props.name.split(".").at(-1)}` : "this kind of")
	return (
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center" data-component="file-no-preview">
			<p class="text-base font-medium text-text">No preview for this file</p>
			<p class="max-w-sm text-sm leading-relaxed text-muted">Save it to open in an app that supports {ext()} files.</p>
			<a
				class="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--panel-edge)] px-2.5 text-xs text-text hover:bg-hover"
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
