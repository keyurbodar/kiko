import { Show, createMemo, onMount, type JSX } from "solid-js"
import { useApp } from "../lib/store"
import { browser, handBack, openLive, startBrowser } from "./browser"

const button = "h-7 shrink-0 rounded-md bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] px-3 text-[12px] font-medium text-foreground disabled:opacity-60"
const primary = "h-7 shrink-0 rounded-md bg-[var(--primary)] px-3 text-[12px] font-medium text-[var(--primary-foreground)] disabled:opacity-60"

/** The newest browser request in the open chat, while it is still the newest message that asks. */
function openAsk(): string | null {
  const messages = useApp.activeMessages()
  const last = messages.findLast((m) => m.event?.kind === "browser_control")
  if (!last) return null
  // A later human message means the request was answered or moved on from.
  return messages.at(-1) === last || !messages.some((m) => m.sender === "user" && m.sentAt > last.sentAt) ? last.body : null
}

export function BrowserButtons(): JSX.Element {
	return (
		<span class="flex shrink-0 gap-1.5" data-component="browser-buttons">
			<Show
				when={browser()?.takeover}
				fallback={
					<>
						<button type="button" class={button} data-action="browser-watch" disabled={browser()?.switching} onClick={() => openLive("watch")}>
							Watch
						</button>
						<button type="button" class={primary} data-action="browser-takeover" disabled={browser()?.switching} onClick={() => openLive("control")}>
							Take control
						</button>
					</>
				}
			>
				<button type="button" class={button} data-action="browser-open" onClick={() => openLive("control")}>
					Open
				</button>
				<button type="button" class={primary} data-action="browser-handback" onClick={handBack}>
					Release control
				</button>
			</Show>
		</span>
	)
}

/**
 * The one place the browser is controlled: a bar just above the composer, where the human is
 * already looking. The transcript says what the agent asked in a system line and nothing more, so
 * a request never draws the same two buttons twice in two shapes.
 */
export default function BrowserChip(props: { slugs: readonly string[] }): JSX.Element {
	onMount(startBrowser)
	const mine = createMemo(() => browser()?.tabs.filter((t) => props.slugs.includes(t.slug)) ?? [])
	const ask = createMemo(() => openAsk())
	const label = () => {
		const state = browser()
		if (state?.switching) return "Opening browser"
		if (state?.takeover) return "You have control. Agents are paused."
		const first = mine()[0]
		if (first) return `${first.agent} is on ${first.host}`
		return ask() ? "An agent needs you in the browser." : ""
	}
	return (
		<Show when={mine().length > 0 || browser()?.takeover || ask() !== null}>
			<div
				class="mx-1.5 mb-1.5 flex items-center gap-3 rounded-lg bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)] py-1 pr-1 pl-3 text-[13px] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)] backdrop-blur-sm"
				role="status"
				data-component="browser-chip"
				data-state={browser()?.switching ? "switching" : browser()?.takeover ? "takeover" : "idle"}
			>
				<span class="font-medium">Browser</span>
				<span class="min-w-0 flex-1 truncate text-[color-mix(in_oklab,var(--foreground)_60%,transparent)]" data-field="browser-label">
					{label()}
				</span>
				<BrowserButtons />
			</div>
		</Show>
	)
}
