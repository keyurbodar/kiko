import { Show, createMemo, onMount, type JSX } from "solid-js"
import { browser, browserError, handBack, openLive, startBrowser } from "./browser"

/*
 * The browser chip (architecture section 27.7). It shows above the composer while one of this
 * room's agents holds a tab. Watch opens a read-only live view and the agent keeps working. Take
 * over pauses the agent's next action until Hand back.
 */

const button = "h-7 shrink-0 rounded-md bg-[color-mix(in_oklab,var(--text)_8%,transparent)] px-3 text-[12px] font-medium text-text disabled:opacity-60"
const primary = "h-7 shrink-0 rounded-md bg-[var(--accent-fill)] px-3 text-[12px] font-medium text-[var(--on-accent)] disabled:opacity-60"

/** Watch and Take over, or Hand back. The share card draws the same buttons. */
export function BrowserButtons(): JSX.Element {
	return (
		<span class="flex shrink-0 gap-1.5" data-component="browser-buttons">
			<Show
				when={browser()?.takeover}
				fallback={
					<>
						<button type="button" class={button} data-action="browser-watch" disabled={!browser() || browser()?.switching} onClick={() => openLive("watch")}>
							Watch
						</button>
						<button type="button" class={primary} data-action="browser-takeover" disabled={!browser() || browser()?.switching} onClick={() => openLive("control")}>
							Take over
						</button>
					</>
				}
			>
				<button type="button" class={button} data-action="browser-open" onClick={() => openLive("control")}>
					Open
				</button>
				<button type="button" class={primary} data-action="browser-handback" onClick={handBack}>
					Hand back
				</button>
			</Show>
		</span>
	)
}

export default function BrowserChip(props: { slugs: readonly string[] }): JSX.Element {
	onMount(startBrowser)
	const mine = createMemo(() => browser()?.tabs.filter((t) => props.slugs.includes(t.slug)) ?? [])
	const label = () => {
		const state = browser()
		if (state?.switching) return "Opening browser"
		if (state?.takeover) return "You are using the browser"
		const first = mine()[0]
		return first ? `${first.agent} is on ${first.host}` : ""
	}
	return (
		<Show when={mine().length > 0}>
			<div
				class="mx-1.5 mb-1.5 flex items-center gap-3 rounded-lg bg-[color-mix(in_oklab,var(--text)_3%,transparent)] py-1 pr-1 pl-3 text-[13px] text-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_10%,transparent)] backdrop-blur-sm"
				role="status"
				data-component="browser-chip"
				data-state={browser()?.switching ? "switching" : browser()?.takeover ? "takeover" : "idle"}
			>
				<span class="font-medium">Browser</span>
				<span class="min-w-0 flex-1 truncate text-[color-mix(in_oklab,var(--text)_60%,transparent)]" data-field="browser-label">
					{label()}
				</span>
				<BrowserButtons />
			</div>
			<Show when={browserError()}>
				<p class="mx-3 mb-1.5 text-[12px] text-[var(--danger)]" data-component="browser-error">
					{browserError()}
				</p>
			</Show>
		</Show>
	)
}
