import type { ExecutorResult, ExecutorStatus } from "@yuki/protocol"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Dialog } from "../lib/dialog"
import { cn } from "../lib/cn"
import { Button, Empty, Group, Item, Notice, buttonClass, fieldClass } from "./kit"
import { createExecutorClient, createMockExecutor, type ExecutorClient } from "./integrations-client"

/*
 * The integrations section. It shows what the server says and names nothing itself: the
 * connection state, the organization, and the tool list all come from the user socket.
 * The group links to the service. Connect opens the sign-in at the
 * address the server returns. The paste-key form is the fallback; its field is cleared
 * before the request leaves, so a key never outlives the click.
 */

export const EXECUTOR_HOME = "https://v2.executor.sh"

async function openClient(): Promise<ExecutorClient> {
	// The dev mock, same rule as the chat data layer. A production build drops this branch.
	if (import.meta.env.DEV && import.meta.env.VITE_YUKI_SYNC === "mock") return createMockExecutor()
	return createExecutorClient()
}

type View = { status: ExecutorStatus | null; tools: readonly string[] | null }

export function Integrations(props: { client?: ExecutorClient; open?: (url: string) => void }) {
	const [keyOpen, setKeyOpen] = createSignal(false)
	const [view, setView] = createSignal<View>({ status: null, tools: null })
	const [error, setError] = createSignal<string | null>(null)
	const [busy, setBusy] = createSignal(false)
	const [confirming, setConfirming] = createSignal(false)
	let client: ExecutorClient | undefined
	let key: HTMLInputElement | undefined
	let closed = false

	const open = (url: string) => (props.open ? props.open(url) : window.location.assign(url))

	function apply(result: ExecutorResult) {
		if (!result.ok) return setError(result.error)
		setError(null)
		setView((v) => ({ status: result.status, tools: result.status.connected ? (result.tools ?? v.tools) : null }))
	}

	async function load() {
		// The tool list needs a credential, so ask for the status alone first.
		const result = await client?.request({ t: "executorStatus" })
		if (!result || closed) return
		apply(result)
		if (result.ok && result.status.connected && !result.tools) {
			const listed = await client?.request({ t: "executorStatus", tools: true })
			if (listed && !closed) apply(listed)
		}
	}

	onMount(async () => {
		const c = props.client ?? (await openClient())
		if (closed) return c.close()
		client = c
		c.onPush((result) => {
			apply(result)
			// A push that connects without a tool list asks for it.
			if (result.ok && result.status.connected && !result.tools) void load()
		})
		void load()
	})
	onCleanup(() => {
		closed = true
		if (!props.client) client?.close()
	})

	async function run(fn: () => Promise<ExecutorResult | undefined>) {
		setBusy(true)
		setError(null)
		try {
			const result = await fn()
			if (result) {
				apply(result)
				if (result.ok && result.authorizeUrl) open(result.authorizeUrl)
				else if (result.ok && result.status.connected) await load()
			}
		} finally {
			setBusy(false)
		}
	}

	const signIn = () => run(async () => client?.request({ t: "connectExecutor" }))

	function submitKey(event: SubmitEvent) {
		event.preventDefault()
		if (!key) return
		const apiKey = key.value.trim()
		key.value = ""
		if (!apiKey) return
		void run(async () => client?.request({ t: "connectExecutor", apiKey }))
	}

	function disconnect() {
		setConfirming(false)
		void run(async () => client?.request({ t: "disconnectExecutor" }))
	}

	const status = () => view().status

	const tools = () => view().tools

	return (
		<div class="flex flex-col gap-8" data-component="integrations">
			<Show when={error()}>
				<Notice data-component="integrations-error">{error()}</Notice>
			</Show>
			<Group
				title="Executor"
				action={
					<a class={buttonClass("ghost")} href={EXECUTOR_HOME} target="_blank" rel="noreferrer" data-component="integrations-link">
						Learn more
					</a>
				}
			>
				<Show when={status()} fallback={<Empty>Loading</Empty>}>
					<Show
						when={status()?.connected}
						fallback={
							<Item
								data-state="empty"
								icon={<GridIcon />}
								title="Executor"
								meta="Not connected"
								actions={
									<Button variant="primary" data-action="connect" disabled={busy()} onClick={() => void signIn()}>
										{status()?.pending ? "Continue" : "Connect"}
									</Button>
								}
							>
								{/* Sign-in is the way to connect. A key is the fallback, folded away until asked for. */}
								<Show
									when={keyOpen()}
									fallback={
										<Button variant="ghost" class="-ml-2.5" data-action="use-key" onClick={() => setKeyOpen(true)}>
											Use an API key instead
										</Button>
									}
								>
									<form class="flex gap-2" onSubmit={submitKey} data-method="api_key">
										<label class="sr-only" for="integrations-key">Executor API key</label>
										<input
											id="integrations-key"
											ref={key}
											type="password"
											name="yuki-integration-secret"
											autocomplete="off"
											autocapitalize="off"
											spellcheck={false}
											placeholder="exp_..."
											autofocus
											class={cn(fieldClass, "flex-1")}
											data-component="integrations-key"
										/>
										<Button type="submit" variant="secondary" disabled={busy()} data-action="save-key">
											Save
										</Button>
									</form>
								</Show>
							</Item>
						}
					>
						<Item
							data-state="connected"
							icon={<GridIcon />}
							title={<span class="truncate" data-field="organization">{status()?.organization ?? "Connected"}</span>}
							meta={
								<span data-field="tool-count">
									{tools() ? `${tools()!.length} ${tools()!.length === 1 ? "tool" : "tools"}` : "Loading tools"}
									{" · "}
									{status()?.kind === "api_key" ? "API key" : "Signed in"}
								</span>
							}
							actions={
								<Button variant="danger" data-action="disconnect" disabled={busy()} onClick={() => setConfirming(true)}>
									Disconnect
								</Button>
							}
						/>
					</Show>
				</Show>
			</Group>
			<Show when={status()?.connected}>
				<Group title="Tools">
					<Show when={tools()} fallback={<Empty>Loading tools</Empty>}>
						<Show when={tools()!.length > 0} fallback={<Empty>No tools yet</Empty>}>
							<ul class="flex flex-col py-1" data-component="tool-list">
								<For each={tools() ?? []}>
									{(name) => (
										<li
											class="truncate px-4 py-1.5 font-mono text-[13px] text-text"
											style={{ "content-visibility": "auto", "contain-intrinsic-size": "auto 30px" }}
											data-tool={name}
										>
											{name}
										</li>
									)}
								</For>
							</ul>
						</Show>
					</Show>
				</Group>
			</Show>
			<Dialog
				open={confirming()}
				onClose={() => setConfirming(false)}
				title="Disconnect Executor?"
				description="Your agents lose these tools until you connect again."
				data-component="executor-disconnect"
				footer={
					<>
						<Button variant="ghost" data-action="cancel-disconnect" onClick={() => setConfirming(false)}>
							Cancel
						</Button>
						<Button variant="danger" data-action="confirm-disconnect" onClick={disconnect}>
							Disconnect
						</Button>
					</>
				}
			/>
		</div>
	)
}

function GridIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />
		</svg>
	)
}
