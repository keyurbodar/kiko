import type { MemoryRecord, MemoryVersion } from "@kiko/protocol"
import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js"
import { session } from "../../../app/session"
import { Editor, preloadEditor } from "./editor"
import { memoryFor } from "./instance"
import { forChat, groupRecords, parseBody, snippet, splitLinks } from "./records"
import type { MemoryStore } from "./store"

const button =
	"h-8 rounded-lg bg-btn px-3 text-sm text-text hover:bg-btn-hover disabled:opacity-40 data-[danger]:text-[oklch(var(--l-danger)_var(--c-danger)_var(--h-danger))]"

function when(at: number): string {
	return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).toLowerCase()
}

/* Text with `[[id]]` links. A link to a record that exists navigates to it. */
function Linked(props: { text: string; store: MemoryStore; onOpen: (id: string) => void }) {
	return (
		<For each={splitLinks(props.text)}>
			{(piece) =>
				"link" in piece ? (
					<Show
						when={props.store.get(piece.link)}
						fallback={<span class="text-faint">[[{piece.link}]]</span>}
					>
						{(r) => (
							<button type="button" class="text-accent hover:underline" data-component="memory-link" onClick={() => props.onOpen(r().id)}>
								{r().title}
							</button>
						)}
					</Show>
				) : (
					piece.text
				)
			}
		</For>
	)
}

function Body(props: { body: string; store: MemoryStore; onOpen: (id: string) => void }) {
	const blocks = createMemo(() => parseBody(props.body))
	return (
		<div class="flex flex-col gap-2 text-sm leading-relaxed text-text" data-component="memory-body">
			<Show when={blocks().length} fallback={<p class="text-weak">nothing here yet</p>}>
				<For each={blocks()}>
					{(b) =>
						b.kind === "heading" ? (
							<h3 class="mt-2 font-medium">
								<Linked text={b.text} store={props.store} onOpen={props.onOpen} />
							</h3>
						) : (
							<p class={b.kind === "bullet" ? "relative pl-4 before:absolute before:left-1 before:content-['\\2022']" : ""}>
								<Linked text={b.text} store={props.store} onOpen={props.onOpen} />
							</p>
						)
					}
				</For>
			</Show>
		</div>
	)
}

function History(props: { record: MemoryRecord; store: MemoryStore }) {
	const versions = () => props.store.state.history[props.record.id]
	createEffect(on(() => props.record.id, (id) => void props.store.loadHistory(id)))
	const [open, setOpen] = createSignal<number | null>(null)
	return (
		<section class="flex flex-col gap-2" data-component="memory-history" aria-label="history">
			<h3 class="text-sm font-medium text-weak">history</h3>
			<Show when={versions()?.length} fallback={<p class="text-sm text-weak">{versions() ? "no earlier versions" : "loading"}</p>}>
				<For each={versions()}>
					{(v: MemoryVersion) => (
						<div class="rounded-lg bg-bg-subtle p-3 text-sm" data-component="memory-version" data-version={v.version}>
							<div class="flex items-center gap-2">
								<button
									type="button"
									class="flex-1 text-left text-weak hover:text-text"
									onClick={() => setOpen(open() === v.version ? null : v.version)}
								>
									version {v.version} · {v.author} · {when(v.at)}
								</button>
								<button type="button" class={button} data-action="restore" onClick={() => void props.store.restore(props.record.id, v)}>
									restore
								</button>
							</div>
							<Show when={open() === v.version}>
								<pre class="mt-2 whitespace-pre-wrap font-[inherit] text-text">{v.body || "empty"}</pre>
							</Show>
						</div>
					)}
				</For>
			</Show>
		</section>
	)
}


/** One record: its body, and edit, pin, history, archive, delete. Sized for the info panel. */
export function RecordView(props: { record: MemoryRecord; store: MemoryStore; onOpen: (id: string) => void; onGone: () => void }) {
	const [editing, setEditing] = createSignal(false)
	const [draft, setDraft] = createSignal("")
	const [showHistory, setShowHistory] = createSignal(false)
	const [confirm, setConfirm] = createSignal(false)
	const r = () => props.record
	const locked = () => ["profile", "now", "todo"].includes(r().id)

	createEffect(
		on(
			() => r().id,
			() => {
				setEditing(false)
				setConfirm(false)
			},
		),
	)

	const edit = () => {
		setDraft(r().body)
		setEditing(true)
	}
	const save = () => {
		void props.store.save(r().id, draft())
		setEditing(false)
	}
	const remove = () => {
		if (!confirm()) return setConfirm(true)
		const id = r().id
		props.onGone()
		void props.store.remove(id)
	}

	return (
		<article class="flex flex-col gap-3" data-component="memory-record" data-id={r().id}>
			<header>
				<h2 class="truncate text-base font-medium text-text">{r().title}</h2>
				<p class="text-xs text-weak">
					{r().type} · version {r().version} · changed {when(r().updatedAt)}
					<Show when={r().aliases.length}> · also {r().aliases.join(", ")}</Show>
				</p>
			</header>
			<div class="flex flex-wrap gap-1.5">
				<Show
					when={editing()}
					fallback={
						<>
							<button type="button" class={button} data-action="edit" onPointerEnter={() => void preloadEditor()} onFocus={() => void preloadEditor()} onClick={edit}>
								edit
							</button>
							<button type="button" class={button} data-action="pin" aria-pressed={r().pinned} onClick={() => void props.store.pin(r().id, !r().pinned)}>
								{r().pinned ? "unpin" : "pin"}
							</button>
							<button type="button" class={button} data-action="history" aria-pressed={showHistory()} onClick={() => setShowHistory(!showHistory())}>
								history
							</button>
							<Show when={!locked()}>
								<button type="button" class={button} data-action="archive" onClick={() => void props.store.archive(r().id, !r().archived)}>
									{r().archived ? "unarchive" : "archive"}
								</button>
								<button type="button" class={button} data-danger="" data-action="delete" onClick={remove} onBlur={() => setConfirm(false)}>
									{confirm() ? "sure?" : "delete"}
								</button>
							</Show>
						</>
					}
				>
					<button type="button" class={button} data-action="cancel" onClick={() => setEditing(false)}>
						cancel
					</button>
					<button type="button" class={button} data-action="save" onClick={save}>
						save
					</button>
				</Show>
			</div>
			<Show when={editing()} fallback={<Body body={r().body} store={props.store} onOpen={props.onOpen} />}>
				<Editor value={draft()} onChange={setDraft} />
			</Show>
			<Show when={showHistory() && !editing()}>
				<History record={r()} store={props.store} />
			</Show>
		</article>
	)
}

function Row(props: { record: MemoryRecord; onOpen: (id: string) => void }) {
	const r = () => props.record
	return (
		<button
			type="button"
			class="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-nav-hover"
			data-component="memory-row"
			data-id={r().id}
			data-pinned={r().pinned ? "" : undefined}
			onClick={() => props.onOpen(r().id)}
		>
			<span class="flex items-center gap-1 text-sm text-text">
				<span class="truncate">{r().title}</span>
				<Show when={r().pinned}>
					<span class="text-xs text-weak">pinned</span>
				</Show>
			</span>
			<span class="block truncate text-xs text-weak">{snippet(r())}</span>
		</button>
	)
}

/** The whole searchable list, grouped by type. */
export function MemoryList(props: { store: MemoryStore; onOpen: (id: string) => void }) {
	const [query, setQuery] = createSignal("")
	const groups = createMemo(() => groupRecords(props.store.state.records, query()))
	return (
		<nav class="flex flex-col gap-2" aria-label="memory records" data-component="memory-list">
			<input
				type="search"
				class="h-9 rounded-lg bg-input px-3 text-sm text-text outline-none placeholder:text-weak"
				placeholder="search memory"
				aria-label="search memory"
				value={query()}
				onInput={(e) => setQuery(e.currentTarget.value)}
			/>
			<For each={groups()}>
				{(g) => (
					<section data-group={g.key}>
						<h3 class="px-2 pb-1 text-xs text-weak">{g.label}</h3>
						<For each={g.records}>{(r) => <Row record={r} onOpen={props.onOpen} />}</For>
					</section>
				)}
			</For>
			<Show when={props.store.state.loaded && !groups().length}>
				<p class="px-2 text-sm text-weak">{query() ? "nothing matches" : "kiko remembers nothing yet"}</p>
			</Show>
		</nav>
	)
}

/** The few records this chat leans on, for the panel's home card. */
export function ChatMemory(props: { store: MemoryStore; chatName: string; onOpen: (id: string) => void }) {
	const top = createMemo(() => forChat(props.store.state.records, props.chatName))
	return (
		<div data-component="memory-chat">
			<For each={top()}>{(r) => <Row record={r} onOpen={props.onOpen} />}</For>
			<Show when={props.store.state.loaded && !top().length}>
				<p class="px-2 py-1 text-sm text-weak">nothing remembered yet</p>
			</Show>
		</div>
	)
}

export function MemoryError(props: { store: MemoryStore }) {
	return (
		<Show when={props.store.state.error}>
			<p class="rounded-lg bg-bg-subtle px-3 py-2 text-sm text-[oklch(var(--l-danger)_var(--c-danger)_var(--h-danger))]" role="alert" data-component="memory-error">
				{props.store.state.error}{" "}
				<button type="button" class="underline" onClick={() => props.store.dismissError()}>
					dismiss
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
