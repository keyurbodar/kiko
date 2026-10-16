// The note above the composer, after t3code's ComposerServerUpdateStatus. It shows only when the backend is
// too old for this app to talk to, because then sending fails. Progress and failures live in the sidebar pill.
import { Show } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { DownloadIcon } from "@kiko/ui/icons"
import { startUpdate, view } from "./update-flow"

export default function UpdateNotice() {
	const shown = () => {
		const v = view()
		return v.kind === "update" && v.blocked
	}
	return (
		<Show when={shown()}>
			<div class="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] px-3 py-2 text-sm" role="status" data-component="update-notice" data-kind={view().kind}>
				<HugeIcon icon={DownloadIcon} size={14} />
				<span class="min-w-0 flex-1 truncate">Update your backend to keep using Kiko</span>
				<button type="button" class="update-pill" onClick={() => void startUpdate()} data-part="update-start">
					Update now
				</button>
			</div>
		</Show>
	)
}
