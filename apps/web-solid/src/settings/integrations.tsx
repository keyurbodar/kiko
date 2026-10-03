import type { ExecutorResult, ExecutorStatus } from "@kiko/protocol"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { urls } from "../lib/store"
import { createExecutorClient, createMockExecutor, type ExecutorClient } from "./integrations-client"

/*
 * The integrations section. It shows what the server says and names nothing itself: the
 * connection state, the organization, and the tool list all come from the user socket.
 * The empty state explains the service in two lines. Connect opens the sign-in at the
 * address the server returns. The paste-key form is the fallback; its field is cleared
 * before the request leaves, so a key never outlives the click.
 *
 * ASSUMPTION: the mode option (architecture section 12.4) is a per-browser preference for
 * now, kept in localStorage. The server has no frame to store it per user yet.
 */

export const EXECUTOR_HOME = "https://executor.sh"
export const MODE_KEY = "kiko.executor.mode"
export const MODES = [
	{ id: "default", label: "code mode" },
	{ id: "passthrough", label: "passthrough" },
] as const
type Mode = (typeof MODES)[number]["id"]

function readMode(): Mode {
	try {
		const v = localStorage.getItem(MODE_KEY)
		return MODES.some((m) => m.id === v) ? (v as Mode) : "default"
	} catch {
		return "default"
	}
}

async function openClient(): Promise<ExecutorClient> {
	// The dev mock, same rule as the chat data layer. A production build drops this branch.
	if (import.meta.env.DEV && import.meta.env.VITE_KIKO_SYNC === "mock") return createMockExecutor()
	return createExecutorClient({ url: urls.user() })
}

type View = { status: ExecutorStatus | null; tools: readonly string[] | null }

export function Integrations(props: { client?: ExecutorClient; open?: (url: string) => void }) {
	const [keyOpen, setKeyOpen] = createSignal(false)
	const [view, setView] = createSignal<View>({ status: null, tools: null })
	const [error, setError] = createSignal<string | null>(null)
	const [busy, setBusy] = createSignal(false)
	const [confirming, setConfirming] = createSignal(false)
	const [mode, setMode] = createSignal<Mode>(readMode())
	let client: ExecutorClient | undefined
	let key: HTMLInputElement | undefined
	let closed = false

	const open = (url: string) => (props.open ? props.open(url) : window.location.assign(url))

	function apply(result: ExecutorResult) {
		if (!result.ok) return setError(result.error.toLowerCase())
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

	function pickMode(next: Mode) {
		setMode(next)
		try {
			localStorage.setItem(MODE_KEY, next)
		} catch {}
	}

	const status = () => view().status

	return (
		<div class="flex min-h-0 flex-1 flex-col gap-3" data-component="integrations">
			<Show when={error()}>
				<p class="text-xs text-[var(--danger)]" role="alert" data-component="integrations-error">{error()}</p>
			</Show>
			<Show when={status()} fallback={<p class="p-3 text-sm text-weak">loading</p>}>
				<Show
					when={status()?.connected}
					fallback={
						<section class="flex flex-col overflow-hidden rounded-2xl bg-[var(--surface-raised)]" data-state="empty">
							<div class="flex items-center gap-3 p-4">
								<span class="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--input-bg)] text-[var(--accent)]">
									<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />
									</svg>
								</span>
								<span class="min-w-0 flex-1">
									<span class="block text-[15px] text-text">executor</span>
									<span class="block text-xs text-weak" data-component="integrations-about">
										one place for your agents to reach the apps you use.{" "}
										<a class="underline" href={EXECUTOR_HOME} target="_blank" rel="noreferrer" data-component="integrations-link">
											learn more
										</a>
									</span>
								</span>
								<button
									type="button"
									class="h-9 shrink-0 rounded-xl bg-[var(--accent-fill)] px-4 text-sm text-[var(--on-accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
									data-action="connect"
									disabled={busy()}
									onClick={() => void signIn()}
								>
									{status()?.pending ? "continue" : "connect"}
								</button>
							</div>
							{/* Sign-in is the way to connect. A key is the fallback, folded away until asked for. */}
							<Show
								when={keyOpen()}
								fallback={
									<button
										type="button"
										class="px-4 pb-3 text-left text-xs text-weak hover:text-text"
										data-action="use-key"
										onClick={() => setKeyOpen(true)}
									>
										use an api key instead
									</button>
								}
							>
							<form class="flex flex-col gap-2 px-4 pb-3" onSubmit={submitKey} data-method="api_key">
								<label class="sr-only" for="integrations-key">executor api key</label>
								<div class="flex gap-2">
									<input
										id="integrations-key"
										ref={key}
										type="password"
										name="kiko-integration-secret"
										autocomplete="off"
										autocapitalize="off"
										spellcheck={false}
										placeholder="exec_..."
										autofocus
										class="h-9 min-w-0 flex-1 rounded-xl bg-[var(--input-bg)] px-3 text-sm text-text outline-none placeholder:text-weak focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
										data-component="integrations-key"
									/>
									<button
										type="submit"
										disabled={busy()}
										class="h-9 rounded-xl bg-[var(--btn-bg)] px-3 text-sm text-text hover:bg-[var(--btn-bg-hover)] disabled:opacity-50"
										data-action="save-key"
									>
										save
									</button>
								</div>
							</form>
							</Show>
						</section>
					}
				>
					<section class="flex min-h-0 flex-1 flex-col gap-3" data-state="connected">
						<div class="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface-raised)] p-4">
							<span class="min-w-0">
								<span class="block truncate text-[15px] text-text" data-field="organization">
									{status()?.organization?.toLowerCase() ?? "connected"}
								</span>
								<span class="block truncate text-xs text-weak" data-field="tool-count">
									{view().tools ? `${view().tools!.length} ${view().tools!.length === 1 ? "tool" : "tools"}` : "loading tools"}
									{" · "}
									{status()?.kind === "api_key" ? "api key" : "signed in"}
								</span>
							</span>
							<button
								type="button"
								class="h-9 rounded-[10px] px-3 text-xs text-muted hover:bg-[var(--tab-bg-active)] disabled:opacity-50 md:h-7 md:px-2"
								data-action="disconnect"
								disabled={busy()}
								onClick={() => setConfirming(true)}
							>
								disconnect
							</button>
						</div>
						<label class="flex items-center justify-between gap-3 text-xs text-weak">
							mode
							<select
								class="h-10 rounded-[10px] bg-[var(--input-bg)] px-2 text-sm md:h-8 text-[var(--tab-text-active)]"
								data-component="integrations-mode"
								value={mode()}
								onChange={(e) => pickMode(e.currentTarget.value as Mode)}
							>
								<For each={MODES}>{(m) => <option value={m.id}>{m.label}</option>}</For>
							</select>
						</label>
						<ul class="flex min-h-0 flex-col overflow-y-auto rounded-2xl bg-[var(--surface-raised)] p-1" data-component="tool-list">
							<For each={view().tools ?? []}>
								{(name) => (
									<li
										class="truncate rounded-[10px] px-3 py-1.5 text-sm text-muted"
										style={{ "content-visibility": "auto", "contain-intrinsic-size": "auto 32px" }}
										data-tool={name}
									>
										{name}
									</li>
								)}
							</For>
						</ul>
					</section>
				</Show>
			</Show>
			<ModalV2 open={confirming()} onOpenChange={setConfirming}>
				<ModalV2.Portal>
					<ModalV2.Overlay />
					<ModalV2.Content class="w-[min(420px,94vw)] flex-col gap-3 rounded-[16px] bg-bg p-4 shadow-xl">
						<ModalV2.Title class="text-sm font-medium text-muted">disconnect?</ModalV2.Title>
						<p class="text-xs text-weak">your agents lose these tools until you connect again.</p>
						<div class="flex justify-end gap-2">
							<button type="button" class="h-10 rounded-[10px] px-4 text-sm text-muted hover:bg-[var(--tab-bg-hover)] md:h-8" data-action="cancel-disconnect" onClick={() => setConfirming(false)}>
								cancel
							</button>
							<button type="button" class="h-10 rounded-[10px] bg-[var(--danger-wash)] px-4 text-sm text-[var(--danger)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] md:h-8" data-action="confirm-disconnect" onClick={disconnect}>
								disconnect
							</button>
						</div>
					</ModalV2.Content>
				</ModalV2.Portal>
			</ModalV2>
		</div>
	)
}
