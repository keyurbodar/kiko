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
export const COMPOSIO_PLATFORM = "https://platform.composio.dev"

function GridIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />
		</svg>
	)
}

function KeyIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="5.5" cy="10.5" r="3" />
			<path d="M7.6 8.4 13.5 2.5M11 5l2 2" />
		</svg>
	)
}

type Where = "app" | "developer"

function KeyField(props: { id: string; label: string; placeholder: string; submit: string; busy: boolean; onKey: (key: string) => void; [data: `data-${string}`]: string | undefined }) {
	let input: HTMLInputElement | undefined
	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!input) return
		const key = input.value.trim()
		input.value = ""
		if (key) props.onKey(key)
	}
	return (
		<form class="flex gap-2" onSubmit={submit}>
			<label class="sr-only" for={props.id}>{props.label}</label>
			<input
				id={props.id}
				ref={input}
				type="password"
				name={`yuki-${props.id}-secret`}
				autocomplete="off"
				autocapitalize="off"
				spellcheck={false}
				placeholder={props.placeholder}
				class={cn(fieldClass, "flex-1")}
				data-component={props.id}
			/>
			<Button type="submit" variant="primary" disabled={props.busy} data-action={props["data-action"]}>
				{props.submit}
			</Button>
		</form>
	)
}

export function Integrations(props: { client?: ComposioClient }) {
	const [status, setStatus] = createSignal<ComposioStatus | null>(null)
	const [error, setError] = createSignal<{ where: Where; text: string } | null>(null)
	const [busy, setBusy] = createSignal(false)
	let client: ComposioClient | undefined
	let closed = false

	function apply(result: ComposioResult, where: Where = "app") {
		if (!result.ok) return setError({ where, text: result.error })
		setError(null)
		setStatus(result.status)
	}

	onMount(() => {
		// The dev mock has no Composio account behind it, so it shows the empty state.
		if (!props.client && import.meta.env.DEV && import.meta.env.VITE_YUKI_SYNC === "mock") return setStatus({ connected: false, rows: 0, developer: false })
		client = props.client ?? createComposioClient()
		client.onPush(apply)
		void client.request({ t: "composioStatus" }).then((r) => !closed && apply(r))
	})
	onCleanup(() => {
		closed = true
		if (!props.client) client?.close()
	})

	async function run(where: Where, ask: () => Promise<ComposioResult | undefined>) {
		setBusy(true)
		setError(null)
		try {
			const result = await ask()
			if (result) apply(result, where)
		} finally {
			setBusy(false)
		}
	}
	const errorAt = (where: Where) => (error()?.where === where ? error()?.text : undefined)

	return (
		<div class="flex flex-col gap-8" data-component="integrations">
			<Group title="Connected apps" data-component="composio">
				<Show when={status()} fallback={<Empty>Loading</Empty>}>
					<Item
						data-state={status()?.connected ? "connected" : "empty"}
						icon={<GridIcon />}
						title="Composio"
						meta={<span data-field="composio-status">{status()?.connected ? "Connected" : "Not connected"}</span>}
						actions={
							<Show when={status()?.connected}>
								<Button variant="danger" data-action="composio-disconnect" disabled={busy()} onClick={() => void run("app", async () => client?.request({ t: "disconnectComposio" }))}>
									Disconnect
								</Button>
							</Show>
						}
					>
						<p class="mb-2 text-[13px] text-muted">Connect your apps through your own Composio account.</p>
						<Show when={!status()?.connected}>
							<KeyField id="composio-key" label="Composio API key" placeholder="ck_..." submit="Connect" busy={busy()} data-action="composio-connect" onKey={(apiKey) => void run("app", async () => client?.request({ t: "connectComposio", apiKey }))} />
							<p class="mt-2 text-[13px] text-muted">
								Copy your key from{" "}
								<a class="underline" href={COMPOSIO_HOME} target="_blank" rel="noreferrer" data-component="composio-link">
									{COMPOSIO_HOME}
								</a>
								, under Settings, then Sessions and API key.
							</p>
						</Show>
						<Show when={errorAt("app")}>
							<Notice data-component="composio-error">{errorAt("app")}</Notice>
						</Show>
					</Item>
					<Show when={status()?.connected}>
						<Item
							data-state={status()?.developer ? "added" : "empty"}
							data-component="composio-developer"
							icon={<KeyIcon />}
							title="Developer key"
							meta={<span data-field="composio-developer-status">{status()?.developer ? "Added" : "Not added"}</span>}
							actions={
								<Show when={status()?.developer}>
									<Button variant="danger" data-action="composio-developer-remove" disabled={busy()} onClick={() => void run("developer", async () => client?.request({ t: "setComposioDeveloperKey", key: null }))}>
										Remove
									</Button>
								</Show>
							}
						>
							<p class="mb-2 text-[13px] text-muted">Optional. Lets agents read your apps in routines and team chats without asking each time.</p>
							<Show when={!status()?.developer}>
								<KeyField id="composio-developer-key" label="Composio developer key" placeholder="ak_..." submit="Add" busy={busy()} data-action="composio-developer-add" onKey={(key) => void run("developer", async () => client?.request({ t: "setComposioDeveloperKey", key }))} />
								<p class="mt-2 text-[13px] text-muted">
									Copy it from{" "}
									<a class="underline" href={COMPOSIO_PLATFORM} target="_blank" rel="noreferrer" data-component="composio-platform-link">
										{COMPOSIO_PLATFORM}
									</a>
									, under Settings, then API keys.
								</p>
							</Show>
							<Show when={errorAt("developer")}>
								<Notice data-component="composio-developer-error">{errorAt("developer")}</Notice>
							</Show>
						</Item>
					</Show>
				</Show>
			</Group>
		</div>
	)
}
