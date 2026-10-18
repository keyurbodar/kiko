// The quiet update affordance at the foot of the sidebar, after t3code's update pill. Loads after first paint.
import { Match, onMount, Show, Switch } from "solid-js"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { DownloadIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { APP_VERSION } from "../lib/version-skew"
import { backendVersion, startUpdate, view, watchLatest } from "./update-flow"

function Versions() {
	return (
		<dl class="grid grid-cols-[auto_auto] gap-x-3 text-sm" data-part="update-versions">
			<dt class="opacity-70">App</dt>
			<dd data-part="app-version">{APP_VERSION}</dd>
			<dt class="opacity-70">Backend</dt>
			<dd data-part="backend-version">{backendVersion() ?? "Unknown"}</dd>
		</dl>
	)
}

export default function UpdatePill() {
	onMount(watchLatest)
	return (
		<Show when={view().kind !== "none"}>
			<div class="px-2 pb-1" data-component="update-pill-row">
				<TooltipV2 placement="top" openDelay={400} value={<Versions />}>
					<Switch>
						<Match when={view().kind === "busy" && view()}>
							{(v) => (
								<span class="update-pill" role="status" data-component="update-pill" data-kind="busy">
									<span class="motion-spin inline-block size-3 rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
									{(v() as { text: string }).text}
								</span>
							)}
						</Match>
						<Match when={true}>
							<button
								type="button"
								class="update-pill"
								data-component="update-pill"
								data-kind={view().kind === "failed" ? "failed" : (view() as { blocked: boolean }).blocked ? "blocked" : "update"}
								onClick={() => void startUpdate()}
							>
								<RemixIcon icon={DownloadIcon} size={14} />
								{view().kind === "failed" ? "Retry update" : (view() as { blocked: boolean }).blocked ? "Update required" : "Update"}
							</button>
						</Match>
					</Switch>
				</TooltipV2>
			</div>
		</Show>
	)
}
