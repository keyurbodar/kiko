import type { ComposioResult, ComposioStatus } from "@yuki/protocol"
import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { cn } from "../lib/cn"
import { Button, Empty, Group, Item, Notice, fieldClass } from "./kit"
import { createComposioClient, type ComposioClient } from "./integrations-client"

/*
 * The integrations section: Composio with the user's own key. It shows what the server says
 * and names nothing itself. The field is cleared before the request leaves, so a key never
 * outlives the click, and the server never sends the key back, only whether it is connected.
 */

export const COMPOSIO_HOME = "https://connect.composio.dev"

function GridIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />
		</svg>
	)
}

export function Integrations(props: { client?: ComposioClient }) {
	const [status, setStatus] = createSignal<ComposioStatus | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	const [busy, setBusy] = createSignal(false)
	let client: ComposioClient | undefined
	let key: HTMLInputElement | undefined
	let closed = false

	function apply(result: ComposioResult) {
		if (!result.ok) return setError(result.error)
		setError(null)
		setStatus(result.status)
	}

	onMount(() => {
		// The dev mock has no Composio account behind it, so it shows the empty state.
		if (!props.client && import.meta.env.DEV && import.meta.env.VITE_YUKI_SYNC === "mock") return setStatus({ connected: false, rows: 0 })
		client = props.client ?? createComposioClient()
		client.onPush(apply)
		void client.request({ t: "composioStatus" }).then((r) => !closed && apply(r))
	})
	onCleanup(() => {
		closed = true
		if (!props.client) client?.close()
	})

	async function run(ask: () => Promise<ComposioResult | undefined>) {
		setBusy(true)
		setError(null)
		try {
			const result = await ask()
			if (result) apply(result)
		} finally {
			setBusy(false)
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!key) return
		const apiKey = key.value.trim()
		key.value = ""
		if (!apiKey) return
		void run(async () => client?.request({ t: "connectComposio", apiKey }))
	}

	return (
		<div class="flex flex-col gap-8" data-component="integrations">
			<Group title="Composio" data-component="composio">
				<Show when={status()} fallback={<Empty>Loading</Empty>}>
					<Item
						data-state={status()?.connected ? "connected" : "empty"}
						icon={<GridIcon />}
						title="Composio"
						meta={<span data-field="composio-status">{status()?.connected ? "Connected" : "Not connected"}</span>}
						actions={
							<Show when={status()?.connected}>
								<Button variant="danger" data-action="composio-disconnect" disabled={busy()} onClick={() => void run(async () => client?.request({ t: "disconnectComposio" }))}>
									Disconnect
								</Button>
							</Show>
						}
					>
						<p class="mb-2 text-[13px] text-muted">Connect your apps through your own Composio account.</p>
						<Show when={!status()?.connected}>
							<form class="flex gap-2" onSubmit={submit}>
								<label class="sr-only" for="composio-key">Composio API key</label>
								<input
									id="composio-key"
									ref={key}
									type="password"
									name="yuki-composio-secret"
									autocomplete="off"
									autocapitalize="off"
									spellcheck={false}
									placeholder="ck_..."
									class={cn(fieldClass, "flex-1")}
									data-component="composio-key"
								/>
								<Button type="submit" variant="primary" disabled={busy()} data-action="composio-connect">
									Connect
								</Button>
							</form>
							<p class="mt-2 text-[13px] text-muted">
								Copy your key from{" "}
								<a class="underline" href={COMPOSIO_HOME} target="_blank" rel="noreferrer" data-component="composio-link">
									{COMPOSIO_HOME}
								</a>
								, under Settings, then Sessions and API key.
							</p>
						</Show>
						<Show when={error()}>
							<Notice data-component="composio-error">{error()}</Notice>
						</Show>
					</Item>
				</Show>
			</Group>
		</div>
	)
}
