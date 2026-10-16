// The compact status above the composer, after t3code's ComposerServerUpdateStatus. It shows only when the
// backend is too old to use, or while an update runs or has failed. A plain "update available" stays in the sidebar pill.
import { Show } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { DownloadIcon } from "@kiko/ui/icons"
import { startUpdate, view } from "./update-flow"

export default function UpdateNotice() {
	const shown = () => {
		const v = view()
		return v.kind === "busy" || v.kind === "failed" || (v.kind === "update" && v.blocked)
	}
	return (
		<Show when={shown()}>
			<div class="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] px-3 py-2 text-sm" role="status" data-component="update-notice" data-kind={view().kind}>
				<Show when={view().kind === "busy"} fallback={<HugeIcon icon={DownloadIcon} size={14} />}>
					<span class="motion-spin inline-block size-3 rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
				</Show>
				<span class="min-w-0 flex-1 truncate">
					{(() => {
						const v = view()
						return v.kind === "busy" ? v.text : v.kind === "failed" ? v.error : "Update your backend to keep using Kiko"
					})()}
				</span>
				<Show when={view().kind !== "busy"}>
					<button type="button" class="update-pill" onClick={startUpdate} data-part="update-start">
						{view().kind === "failed" ? "Retry update" : "Update now"}
					</button>
				</Show>
			</div>
		</Show>
	)
}
