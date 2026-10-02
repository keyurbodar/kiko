import type { MemoryRecord, MemoryVersion } from "@kiko/protocol"
import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js"
import { session } from "../../../app/session"
import { Editor, preloadEditor } from "./editor"
import { IdentityAvatar } from "../../../lib/IdentityAvatar"
import { memoryFor } from "./instance"
import { fact, groupRecords, parseBody, snippet, splitLinks } from "./records"
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

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const shortDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`

function Body(props: { body: string; store: MemoryStore; onOpen: (id: string) => void }) {
	const blocks = createMemo(() => parseBody(props.body))
	return (
		<div class="flex flex-col text-[15px] leading-relaxed text-text" data-component="memory-body">
			<Show when={blocks().length} fallback={<p class="text-sm text-weak">empty. click to write what kiko should remember.</p>}>
				<For each={blocks()}>
					{(b) => {
						if (b.kind === "heading")
							return (
								<h3 class="mt-3 mb-1 text-xs font-medium text-weak first:mt-0">
									<Linked text={b.text} store={props.store} onOpen={props.onOpen} />
								</h3>
							)
						const f = fact(b.text)
						return (
							<div class="flex items-baseline gap-3 py-1" data-component="memory-fact">
								<span class="min-w-0 flex-1">
									<Linked text={f.text} store={props.store} onOpen={props.onOpen} />
								</span>
								<Show when={f.date}>
									<span class="shrink-0 text-xs text-faint" title={f.author ? `added by ${f.author}` : undefined}>
										{shortDay(f.date!)}
									</span>
								</Show>
							</div>
						)
					}}
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

	const Action = (p: { id: string; label: string; path: string; pressed?: boolean; danger?: boolean; onClick: () => void; onBlur?: () => void; onHover?: () => void }) => (
		<button
			type="button"
			class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl bg-bg-subtle px-1 py-2 text-xs text-weak hover:bg-nav-hover hover:text-text aria-pressed:text-accent data-[danger]:text-[oklch(var(--l-danger)_var(--c-danger)_var(--h-danger))]"
			data-action={p.id}
			data-danger={p.danger ? "" : undefined}
			aria-pressed={p.pressed}
			onClick={p.onClick}
			onBlur={p.onBlur}
			onPointerEnter={p.onHover}
			onFocus={p.onHover}
		>
			<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d={p.path} />
			</svg>
			<span class="truncate">{p.label}</span>
		</button>
	)

	return (
		<article class="flex flex-col gap-4" data-component="memory-record" data-id={r().id}>
			<header class="flex flex-col items-center gap-2 pt-2 text-center">
				<Leading record={r()} size={64} />
				<div class="min-w-0 max-w-full">
					<h2 class="truncate text-lg font-semibold text-text">{r().title}</h2>
					<p class="text-xs text-weak">
						{r().type} · edited {ago(r().updatedAt)}
						<Show when={r().version > 1}> · v{r().version}</Show>
					</p>
					<Show when={r().aliases.length}>
						<p class="mt-0.5 truncate text-xs text-faint">also {r().aliases.join(", ")}</p>
					</Show>
				</div>
			</header>
			<Show
				when={editing()}
				fallback={
					<div class="flex gap-2">
						<Action id="edit" label="edit" path="M11 2.5l2.5 2.5L6 12.5H3.5V10z" onClick={edit} onHover={() => void preloadEditor()} />
						<Action id="pin" label={r().pinned ? "unpin" : "pin"} pressed={r().pinned} path="M10.5 1.5l4 4-2 1-2.5 2.5.5 3-1.5 1.5-7-7L3.5 5l3 .5L9 2.5zM5 11l-3.5 3.5" onClick={() => void props.store.pin(r().id, !r().pinned)} />
						<Action id="history" label="history" pressed={showHistory()} path="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5" onClick={() => setShowHistory(!showHistory())} />
						<Show when={!locked()}>
							<Action id="archive" label={r().archived ? "restore" : "archive"} path="M2 3h12v3H2zM3 6v7h10V6M6.5 9h3" onClick={() => void props.store.archive(r().id, !r().archived)} />
							<Action id="delete" label={confirm() ? "sure?" : "delete"} danger path="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9" onClick={remove} onBlur={() => setConfirm(false)} />
						</Show>
					</div>
				}
			>
				<div class="flex justify-end gap-2">
					<button type="button" class={button} data-action="cancel" onClick={() => setEditing(false)}>
						cancel
					</button>
					<button type="button" class={`${button} bg-accent-fill text-white hover:bg-accent-fill hover:opacity-90`} data-action="save" onClick={save}>
						save
					</button>
				</div>
			</Show>
			<Show
				when={editing()}
				fallback={
					<button
						type="button"
						class="rounded-2xl bg-bg-subtle px-4 py-2.5 text-left hover:bg-nav-hover"
						data-action="edit-body"
						title="click to edit"
						onPointerEnter={() => void preloadEditor()}
						onClick={(e) => {
							if ((e.target as HTMLElement).closest("[data-component=memory-link]")) return
							edit()
						}}
					>
						<Body body={r().body} store={props.store} onOpen={props.onOpen} />
					</button>
				}
			>
				<div
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault()
							save()
						} else if (e.key === "Escape") {
							e.stopPropagation()
							setEditing(false)
						}
					}}
				>
					<Editor value={draft()} onChange={setDraft} />
					<p class="mt-1.5 text-right text-xs text-faint">⌘↵ to save · esc to cancel</p>
				</div>
			</Show>
			<Show when={showHistory() && !editing()}>
				<History record={r()} store={props.store} />
			</Show>
		</article>
	)
}

/* Each type gets a hue and a glyph, so the list reads at a glance. People get their own blob. */
const LOOK: Record<string, { hue: number; path: string }> = {
	profile: { hue: 265, path: "M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6a5 5 0 0 1 10 0" },
	now: { hue: 45, path: "M8 4v4l2.5 1.5M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z" },
	todo: { hue: 150, path: "M3 8.5l3 3 7-7" },
	preference: { hue: 330, path: "M2 5h7m3 0h2M2 11h2m3 0h7M9 3.5v3M4 9.5v3" },
	organization: { hue: 210, path: "M3 14V3h6v11M9 7h4v7M5 5.5h2M5 8.5h2M5 11.5h2" },
	procedure: { hue: 185, path: "M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01" },
	conversation: { hue: 25, path: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" },
	archived: { hue: 0, path: "M2 3h12v3H2zM3 6v7h10V6M6.5 9h3" },
}

function Glyph(props: { type: string; size?: number }) {
	const look = () => LOOK[props.type] ?? LOOK.conversation
	const size = () => props.size ?? 32
	return (
		<span
			class="grid shrink-0 place-items-center rounded-full"
			style={{
				width: `${size()}px`,
				height: `${size()}px`,
				background: props.type === "archived" ? "var(--color-btn, rgb(127 127 127 / 0.15))" : `oklch(0.62 0.13 ${look().hue} / 0.2)`,
				color: props.type === "archived" ? "currentColor" : `oklch(0.8 0.13 ${look().hue})`,
			}}
			aria-hidden="true"
		>
			<svg width={size() / 2} height={size() / 2} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
				<path d={look().path} />
			</svg>
		</span>
	)
}

function Leading(props: { record: MemoryRecord; size?: number }) {
	return (
		<Show when={props.record.type === "person"} fallback={<Glyph type={props.record.archived ? "archived" : props.record.type} size={props.size} />}>
			<IdentityAvatar seed={`memory:${props.record.id}`} size={props.size ?? 32} />
		</Show>
	)
}

function Pin() {
	return (
		<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-label="pinned" class="shrink-0 text-weak">
			<path d="M10.5 1.5l4 4-2 1-2.5 2.5.5 3-1.5 1.5-3-3-3.5 3.5-.5-.5 3.5-3.5-3-3L4 4.5l3 .5L9.5 2.5z" />
		</svg>
	)
}

/** `now`, `5m`, `3h`, `2d`, then a short date. */
export function ago(at: number, now = Date.now()): string {
	const s = Math.max(0, (now - at) / 1000)
	if (s < 60) return "now"
	if (s < 3600) return `${Math.floor(s / 60)}m`
	if (s < 86400) return `${Math.floor(s / 3600)}h`
	if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
	return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase()
}

function Row(props: { record: MemoryRecord; onOpen: (id: string) => void }) {
	const r = () => props.record
	const line = () => snippet(r())
	return (
		<button
			type="button"
			class="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-nav-hover active:bg-nav-hover"
			data-component="memory-row"
			data-id={r().id}
			data-pinned={r().pinned ? "" : undefined}
			onClick={() => props.onOpen(r().id)}
		>
			<Leading record={r()} />
			<span class="min-w-0 flex-1">
				<span class="flex items-center gap-1.5">
					<span class="truncate text-[15px] text-text">{r().title}</span>
					<Show when={r().pinned}>
						<Pin />
					</Show>
					<span class="ml-auto shrink-0 pl-2 text-xs text-faint">{ago(r().updatedAt)}</span>
				</span>
				<span class="block truncate text-[13px] text-weak">{line() || "empty"}</span>
			</span>
		</button>
	)
}

const CORE = ["profile", "now", "todo"] as const
const CORE_HINT: Record<(typeof CORE)[number], string> = {
	profile: "who you are",
	now: "what is going on",
	todo: "what is open",
}

/** The three records every user has, as tiles across the top. */
function CoreTiles(props: { store: MemoryStore; onOpen: (id: string) => void }) {
	const core = () => CORE.map((id) => ({ id, record: props.store.get(id) }))
	return (
		<div class="grid grid-cols-3 gap-2" data-component="memory-core">
			<For each={core()}>
				{(c) => (
					<button
						type="button"
						class="flex min-w-0 flex-col items-start gap-2 rounded-2xl bg-bg-subtle p-3 text-left hover:bg-nav-hover active:scale-[0.98]"
						data-component="memory-row"
						data-id={c.id}
						disabled={!c.record}
						onClick={() => props.onOpen(c.id)}
					>
						<Glyph type={c.id} size={28} />
						<span class="w-full min-w-0">
							<span class="block text-sm font-medium text-text">{c.id}</span>
							<span class="line-clamp-2 text-xs leading-snug text-weak">
								{(c.record && snippet(c.record)) || CORE_HINT[c.id]}
							</span>
						</span>
					</button>
				)}
			</For>
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

/** The whole searchable list: the three core tiles, then every other record grouped by type. */
export function MemoryList(props: { store: MemoryStore; onOpen: (id: string) => void }) {
	const [query, setQuery] = createSignal("")
	const groups = createMemo(() => groupRecords(props.store.state.records, query()))
	const searching = () => query().trim().length > 0
	/* The core records live in the tiles, so the groups below skip them unless the user searches. */
	const rest = createMemo(() =>
		searching()
			? groups()
			: groups()
					.map((g) => ({ ...g, records: g.records.filter((r) => !(CORE as readonly string[]).includes(r.id)) }))
					.filter((g) => g.records.length),
	)
	const count = () => props.store.state.records.filter((r) => !r.archived).length
	return (
		<nav class="flex flex-col gap-4" aria-label="memory records" data-component="memory-list">
			<label class="sticky top-0 z-10 flex h-9 items-center gap-2 rounded-xl bg-input px-3 text-weak focus-within:text-text">
				<SearchIcon />
				<input
					type="search"
					class="h-full min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-weak"
					placeholder={count() ? `search ${count()} memories` : "search memory"}
					aria-label="search memory"
					value={query()}
					onInput={(e) => setQuery(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape" && query()) {
							e.stopPropagation()
							setQuery("")
						}
					}}
				/>
			</label>
			<Show when={!searching()}>
				<CoreTiles store={props.store} onOpen={props.onOpen} />
			</Show>
			<For each={rest()}>
				{(g) => (
					<section class="flex flex-col gap-1" data-group={g.key}>
						<h3 class="flex items-baseline gap-1.5 px-2.5 text-xs font-medium text-weak">
							{g.label}
							<span class="text-faint">{g.records.length}</span>
						</h3>
						<div class="flex flex-col rounded-2xl bg-bg-subtle p-1">
							<For each={g.records}>{(r) => <Row record={r} onOpen={props.onOpen} />}</For>
						</div>
					</section>
				)}
			</For>
			<Show when={props.store.state.loaded && searching() && !groups().length}>
				<p class="px-2 py-6 text-center text-sm text-weak">nothing matches "{query().trim()}"</p>
			</Show>
			<Show when={props.store.state.loaded && !searching() && !rest().length}>
				<div class="flex flex-col items-center gap-1 px-6 py-8 text-center">
					<p class="text-sm text-text">nothing else remembered yet</p>
					<p class="text-xs text-weak">tell kiko about people, places, and how you like things done. it keeps them here.</p>
				</div>
			</Show>
		</nav>
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
