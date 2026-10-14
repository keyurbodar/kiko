import type { ComposioResult, ComposioStatus, KernelResult, KernelStatus } from "@kiko/protocol"
import { Show, createSignal, lazy, onCleanup, onMount } from "solid-js"
import { cn } from "../lib/cn"
import { Button, Empty, Group, Item, Notice, fieldClass } from "./kit"
import { createComposioClient, createKernelClient, type ComposioClient, type KernelClient } from "./integrations-client"

export const COMPOSIO_PLATFORM = "https://platform.composio.dev"
const LiveBrowser = lazy(() => import("./live-browser"))

export const KERNEL_HOME = "https://dashboard.onkernel.com"

function GridIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />
		</svg>
	)
}

function GlobeIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="8" cy="8" r="5.5" />
			<path d="M2.5 8h11M8 2.5c1.7 1.6 2.5 3.4 2.5 5.5S9.7 11.9 8 13.5M8 2.5C6.3 4.1 5.5 5.9 5.5 8s.8 3.9 2.5 5.5" />
		</svg>
	)
}

type Where = "app" | "kernel"
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
				name={`kiko-${props.id}-secret`}
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

export function Integrations(props: { client?: ComposioClient; kernel?: KernelClient }) {
	const [status, setStatus] = createSignal<ComposioStatus | null>(null)
	const [error, setError] = createSignal<{ where: Where; text: string } | null>(null)
	const [busy, setBusy] = createSignal(false)
	const errorAt = (where: Where) => (error()?.where === where ? error()?.text : undefined)
	const [kernel, setKernel] = createSignal<KernelStatus | null>(null)
	let client: ComposioClient | undefined
	let kernelClient: KernelClient | undefined
	let closed = false

	function applyKernel(result: KernelResult) {
		if (!result.ok) return setError({ where: "kernel", text: result.error })
		setError(null)
		setKernel(result.status)
	}

	function apply(result: ComposioResult) {
		if (!result.ok) return setError({ where: "app", text: result.error })
		setError(null)
		setStatus(result.status)
	}

	onMount(() => {
		if (!props.client && import.meta.env.DEV && import.meta.env.VITE_KIKO_SYNC === "mock") {
			setKernel({ connected: false, broken: false, browser: null })
			return setStatus({ connected: false, rows: 0 })
		}
		client = props.client ?? createComposioClient()
		client.onPush(apply)
		void client.request({ t: "composioStatus" }).then((r) => !closed && apply(r))
		kernelClient = props.kernel ?? createKernelClient()
		kernelClient.onPush(applyKernel)
		void kernelClient.request({ t: "kernelStatus" }).then((r) => !closed && applyKernel(r))
	})
	onCleanup(() => {
		closed = true
		if (!props.client) client?.close()
		if (!props.kernel) kernelClient?.close()
	})

	async function runKernel(ask: () => Promise<KernelResult | undefined>) {
		setBusy(true)
		setError(null)
		try {
			const result = await ask()
			if (result) applyKernel(result)
		} finally {
			setBusy(false)
		}
	}

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
								<Button variant="danger" data-action="composio-disconnect" disabled={busy()} onClick={() => void run(async () => client?.request({ t: "disconnectComposio" }))}>
									Disconnect
								</Button>
							</Show>
						}
					>
						<p class="mb-2 text-[13px] text-muted-foreground">Connect your apps through your own Composio account.</p>
						<Show when={!status()?.connected}>
							<KeyField id="composio-key" label="Composio API key" placeholder="ak_..." submit="Connect" busy={busy()} data-action="composio-connect" onKey={(apiKey) => void run(async () => client?.request({ t: "connectComposio", apiKey }))} />
							<p class="mt-2 text-[13px] text-muted-foreground">
								Copy your project API key from{" "}
								<a class="underline" href={COMPOSIO_PLATFORM} target="_blank" rel="noreferrer" data-component="composio-link">
									{COMPOSIO_PLATFORM}
								</a>
								, under Settings, then API keys.
							</p>
						</Show>
						<Show when={errorAt("app")}>
							<Notice data-component="composio-error">{errorAt("app")}</Notice>
						</Show>
					</Item>
				</Show>
				<Show when={kernel()}>
					<Item
						data-state={kernel()?.broken ? "broken" : kernel()?.connected ? "connected" : "empty"}
						data-component="kernel"
						icon={<GlobeIcon />}
						title="Kernel browser"
						meta={<span data-field="kernel-status">{kernel()?.broken ? "Key rejected" : kernel()?.connected ? "Connected" : "Not connected"}</span>}
						actions={
							<Show when={kernel()?.connected}>
								<Button variant="danger" data-action="kernel-disconnect" disabled={busy()} onClick={() => void runKernel(async () => kernelClient?.request({ t: "disconnectKernel" }))}>
									Disconnect
								</Button>
							</Show>
						}
					>
						<p class="mb-2 text-[13px] text-muted-foreground">Lets your agents use a real browser, in your own Kernel account.</p>
						<Show when={!kernel()?.connected || kernel()?.broken}>
							<KeyField id="kernel-key" label="Kernel browser" placeholder="sk_..." submit="Connect" busy={busy()} data-action="kernel-connect" onKey={(apiKey) => void runKernel(async () => kernelClient?.request({ t: "connectKernel", apiKey }))} />
							<p class="mt-2 text-[13px] text-muted-foreground">
								Create a key at{" "}
								<a class="underline" href={KERNEL_HOME} target="_blank" rel="noreferrer" data-component="kernel-link">
									{KERNEL_HOME}
								</a>
								, under API keys.
							</p>
						</Show>
						<Show when={errorAt("kernel")}>
							<Notice data-component="kernel-error">{errorAt("kernel")}</Notice>
						</Show>
					</Item>
					<Show when={kernel()?.connected}>
						<LiveBrowser icon={<GlobeIcon />} />
					</Show>
				</Show>
			</Group>
		</div>
	)
}
