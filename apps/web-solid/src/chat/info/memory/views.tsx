import type { LifeLine } from "@yuki/protocol"
import { createResource, createSignal, For, lazy, Show, Suspense } from "solid-js"
import { session } from "../../../app/session"
import { Moment } from "../../../mascot/lazy"
import { memoryFor } from "./instance"
import type { MemoryStore } from "./store"

// Architecture section 13. The memory screen: the user's life log, newest first. What yuki knows comes
// from agents' notes and from every chat's history, a line at a time. The human pins what matters, so
// it heads what every agent reads, redacts what should be gone, and adds a line of their own.

const ModelList = lazy(() => import("../../../settings/model-picker").then((m) => ({ default: m.ModelList })))

const quiet = "rounded-md px-1.5 py-0.5 text-xs text-weak hover:bg-nav-hover hover:text-text"

/** `now`, `5m`, `3h`, `2d`, then a short date. */
export function ago(at: number, now = Date.now()): string {
	const s = Math.max(0, (now - at) / 1000)
	if (s < 60) return "now"
	if (s < 3600) return `${Math.floor(s / 60)}m`
	if (s < 86400) return `${Math.floor(s / 3600)}h`
	if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
	return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function Line(props: { line: LifeLine; store: MemoryStore }) {
	const l = () => props.line
	const [sure, setSure] = createSignal(false)
	return (
		<div class="flex flex-col gap-0.5 rounded-xl px-2.5 py-2 hover:bg-nav-hover" data-component="memory-line" data-pos={l().pos} data-pinned={l().pinned ? "" : undefined}>
			<Show when={!l().redacted} fallback={<span class="text-sm text-faint">Removed</span>}>
				<span class="text-[15px] leading-snug text-text">{l().text}</span>
				<span class="flex items-center gap-1 text-xs text-faint">
					<span>{l().source || "Yuki"}</span>
					<span>·</span>
					<span>{ago(l().at)}</span>
					<Show when={l().tainted}>
						<span title="Written after reading outside content">· from outside</span>
					</Show>
					<span class="ml-auto flex gap-1">
						<Show when={l().pos >= 0}>
							<button type="button" class={quiet} data-action="pin" onClick={() => props.store.pin(l().pos, !l().pinned)}>
								{l().pinned ? "Unpin" : "Pin"}
							</button>
							<button
								type="button"
								class={quiet}
								data-action="redact"
								onClick={() => (sure() ? props.store.redact(l().pos) : setSure(true))}
								onBlur={() => setSure(false)}
							>
								{sure() ? "Remove for good" : "Remove"}
							</button>
						</Show>
					</span>
				</span>
			</Show>
		</div>
	)
}

/** One line of what agents read. A summary line (`#64-127 …`) opens into its halves. */
function ViewLine(props: { text: string; store: MemoryStore }) {
	const id = () => /^#(\d+-\d+) /.exec(props.text)?.[1]
	const opened = () => (id() ? props.store.state.opened[id()!] : undefined)
	return (
		<div class="flex flex-col">
			<Show when={id()} fallback={<span class="py-0.5 text-[13px] leading-snug text-weak">{props.text}</span>}>
				<button type="button" class="py-0.5 text-left text-[13px] leading-snug text-weak hover:text-text" data-component="memory-summary" onClick={() => void props.store.zoom(id()!)}>
					{props.text}
				</button>
				<Show when={opened()}>
					<div class="ml-3 border-l border-border pl-2">
						<For each={opened()}>{(t) => <ViewLine text={t} store={props.store} />}</For>
					</div>
				</Show>
			</Show>
		</div>
	)
}

function SearchIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
			<circle cx="7" cy="7" r="4.75" />
			<path d="M10.5 10.5L14 14" />
		</svg>
	)
}

/** Which model writes the summary lines. The human picks; nothing picks for them. */
function MemoryModelRow(props: { store: MemoryStore }) {
	const [open, setOpen] = createSignal(false)
	const current = () => props.store.state.model
	return (
		<section class="flex flex-col gap-2" data-component="memory-model">
			<button type="button" class="flex items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-nav-hover" onClick={() => setOpen(!open())}>
				<span class="flex-1 text-sm text-text">Summaries written by</span>
				<span class="truncate text-sm text-weak">{current() ? `${current()!.provider}/${current()!.modelId}` : "Default model"}</span>
			</button>
			<Show when={open()}>
				<div class="flex max-h-80 flex-col">
					<Suspense>
						<ModelList
							current={current() ? `${current()!.provider}/${current()!.modelId}` : undefined}
							onPick={(ref) => {
								const at = ref.indexOf("/")
								void props.store.setModel({ provider: ref.slice(0, at), modelId: ref.slice(at + 1) })
								setOpen(false)
							}}
						/>
					</Suspense>
					<Show when={current()}>
						<button type="button" class={`${quiet} self-start`} onClick={() => void props.store.setModel(null)}>
							Use the default model
						</button>
					</Show>
				</div>
			</Show>
		</section>
	)
}

/** The whole screen: search, add a line, what agents read, then every line newest first. */
export function MemoryList(props: { store: MemoryStore }) {
	const [query, setQuery] = createSignal("")
	const [draft, setDraft] = createSignal("")
	const [reading, setReading] = createSignal(false)
	const s = () => props.store.state
	const shown = () => (query().trim() ? (s().results ?? []) : s().lines)
	return (
		<nav class="flex flex-col gap-4" aria-label="Memory" data-component="memory-list">
			<label class="sticky top-0 z-10 flex h-9 items-center gap-2 rounded-xl bg-input px-3 text-weak focus-within:text-text">
				<SearchIcon />
				<input
					type="search"
					class="h-full min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-weak"
					placeholder="Search memory"
					aria-label="Search memory"
					value={query()}
					onInput={(e) => {
						setQuery(e.currentTarget.value)
						void props.store.search(e.currentTarget.value)
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape" && query()) {
							e.stopPropagation()
							setQuery("")
							void props.store.search("")
						}
					}}
				/>
			</label>
			<form
				class="flex items-center gap-2"
				data-component="memory-note"
				onSubmit={(e) => {
					e.preventDefault()
					const text = draft()
					setDraft("")
					void props.store.note(text)
				}}
			>
				<input
					class="h-9 min-w-0 flex-1 rounded-xl bg-input px-3 text-sm text-text outline-none placeholder:text-weak"
					placeholder="Tell Yuki something to remember"
					aria-label="Add a memory"
					maxLength={280}
					value={draft()}
					onInput={(e) => setDraft(e.currentTarget.value)}
				/>
			</form>
			<Show when={!query().trim() && s().view.length}>
				<section class="flex flex-col gap-1" data-component="memory-view">
					<button type="button" class="flex items-baseline gap-1.5 px-2.5 text-left text-xs font-medium text-weak" onClick={() => setReading(!reading())}>
						What every agent reads
						<span class="text-faint">{reading() ? "Hide" : `${s().view.length} lines`}</span>
					</button>
					<Show when={reading()}>
						<div class="flex flex-col rounded-2xl bg-bg-subtle px-3 py-2">
							<For each={s().view}>{(t) => <ViewLine text={t} store={props.store} />}</For>
						</div>
					</Show>
				</section>
			</Show>
			<div class="flex flex-col rounded-2xl bg-bg-subtle p-1">
				<For each={shown()}>{(l) => <Line line={l} store={props.store} />}</For>
			</div>
			<Show when={!query().trim() && s().next !== null}>
				<button type="button" class={`${quiet} self-center`} onClick={() => void props.store.more()}>
					Older
				</button>
			</Show>
			<Show when={s().loaded && query().trim() && !shown().length}>
				<div class="flex flex-col items-center gap-2 px-2 py-6">
					<Suspense>
						<Moment kind="nothing" />
					</Suspense>
					<p class="text-center text-sm text-weak">Nothing matches "{query().trim()}"</p>
				</div>
			</Show>
			<Show when={s().loaded && !query().trim() && !s().lines.length}>
				<div class="flex flex-col items-center gap-1 px-6 py-8 text-center">
					<Suspense>
						<Moment kind="nest" />
					</Suspense>
					<p class="mt-2 text-sm text-text">Nothing remembered yet</p>
					<p class="text-xs text-weak">Talk to Yuki about people, places, and how you like things done. It keeps the lasting parts here.</p>
				</div>
			</Show>
			<MemoryModelRow store={props.store} />
		</nav>
	)
}

export function MemoryError(props: { store: MemoryStore }) {
	return (
		<Show when={props.store.state.error}>
			<p class="rounded-lg bg-bg-subtle px-3 py-2 text-sm text-[var(--danger)]" role="alert" data-component="memory-error">
				{props.store.state.error}{" "}
				<button type="button" class="underline" onClick={() => props.store.dismissError()}>
					Dismiss
				</button>
			</p>
		</Show>
	)
}

/** The memory store for the signed-in user, loaded once the panel needs it. */
export function useMemoryStore() {
	const [store] = createResource(
		() => {
			const s = session()
			return s.status === "signed-in" ? s.user.id : null
		},
		async (userId) => {
			const s = await memoryFor(userId)
			void s.load()
			return s
		},
	)
	return store
}
