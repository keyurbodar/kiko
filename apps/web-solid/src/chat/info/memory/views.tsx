import type { LifeLine } from "@kiko/protocol"
import { ChevronDown, Pin, PinOff, Plus, Search, Trash2 } from "lucide-solid"
import { createResource, createSignal, For, lazy, Show, Suspense } from "solid-js"
import { session } from "../../../app/session"
import { memoryFor } from "./instance"
import { ago, replacedMark } from "./lines"
import type { MemoryStore } from "./store"

const ModelList = lazy(() => import("../../../settings/model-picker").then((m) => ({ default: m.ModelList })))

const quiet = "rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
const icon = "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent-strong hover:text-foreground"

function Line(props: { line: LifeLine; store: MemoryStore }) {
	const l = () => props.line
	const [sure, setSure] = createSignal(false)
	return (
		<div class="group/line flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent" data-component="memory-line" data-pos={l().pos} data-pinned={l().pinned ? "" : undefined}>
			<Show when={!l().redacted} fallback={<span class="text-sm text-secondary-label">Removed</span>}>
				<div class="flex min-w-0 flex-1 flex-col gap-0.5">
					<span class={`text-md leading-snug ${replacedMark(l()) ? "text-muted-foreground line-through" : "text-foreground"}`}>{l().text}</span>
					<span class="flex items-center gap-1 text-xs text-secondary-label">
						<Show when={l().pinned}>
							<Pin size={11} strokeWidth={2} class="text-muted-foreground" aria-label="Pinned" />
						</Show>
						{l().source || "Kiko"} · {ago(l().at)}
						<Show when={replacedMark(l())}>{(mark) => <> · {mark()}</>}</Show>
					</span>
				</div>
				<Show when={l().pos >= 0}>
					<div class="flex shrink-0 gap-0.5 opacity-0 group-hover/line:opacity-100 group-focus-within/line:opacity-100 [@media(hover:none)]:opacity-100">
						<button type="button" class={icon} aria-label={l().pinned ? "Unpin" : "Pin"} title={l().pinned ? "Unpin" : "Pin"} data-action="pin" onClick={() => props.store.pin(l().pos, !l().pinned)}>
							<Show when={l().pinned} fallback={<Pin size={13} strokeWidth={1.75} />}>
								<PinOff size={13} strokeWidth={1.75} />
							</Show>
						</button>
						<button
							type="button"
							class={sure() ? `${quiet} text-error hover:text-error` : icon}
							aria-label="Remove"
							title="Remove"
							data-action="redact"
							onClick={() => (sure() ? props.store.redact(l().pos) : setSure(true))}
							onBlur={() => setSure(false)}
						>
							<Show when={sure()} fallback={<Trash2 size={13} strokeWidth={1.75} />}>
								Remove for good
							</Show>
						</button>
					</div>
				</Show>
			</Show>
		</div>
	)
}

function ViewLine(props: { text: string; store: MemoryStore }) {
	const id = () => /^#(\d+-\d+) /.exec(props.text)?.[1]
	const opened = () => (id() ? props.store.state.opened[id()!] : undefined)
	return (
		<div class="flex flex-col">
			<Show when={id()} fallback={<span class="py-0.5 text-sm leading-snug text-muted-foreground">{props.text}</span>}>
				<button type="button" class="py-0.5 text-left text-sm leading-snug text-muted-foreground hover:text-foreground" data-component="memory-summary" onClick={() => void props.store.zoom(id()!)}>
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

function MemoryModelRow(props: { store: MemoryStore }) {
	const [open, setOpen] = createSignal(false)
	const current = () => props.store.state.model
	return (
		<section class="flex flex-col gap-1" data-component="memory-model">
			<button type="button" class="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-accent" onClick={() => setOpen(!open())}>
				<span class="flex-1 text-sm text-muted-foreground">Summaries written by</span>
				<span class="truncate text-sm text-foreground">{current() ? `${current()!.provider}/${current()!.modelId}` : "Default model"}</span>
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

export function MemoryList(props: { store: MemoryStore }) {
	const [query, setQuery] = createSignal("")
	const [adding, setAdding] = createSignal(false)
	const [reading, setReading] = createSignal(false)
	const s = () => props.store.state
	const shown = () => (query().trim() ? (s().results ?? []) : s().lines)
	const search = (value: string) => {
		setQuery(value)
		void props.store.search(value)
	}
	return (
		<nav class="flex flex-col gap-3" aria-label="Memory" data-component="memory-list">
			<div class="sticky top-0 z-10 flex items-center gap-1 bg-background pb-1">
				<label class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-secondary px-2.5 text-muted-foreground focus-within:text-foreground">
					<Search size={14} strokeWidth={1.75} aria-hidden="true" />
					<input
						type="search"
						class="h-full min-w-0 flex-1 bg-transparent text-md text-foreground outline-none placeholder:text-muted-foreground"
						placeholder="Search memory"
						aria-label="Search memory"
						value={query()}
						onInput={(e) => search(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape" && query()) {
								e.stopPropagation()
								search("")
							}
						}}
					/>
				</label>
				<button type="button" class={`${icon} size-8`} aria-label="Add a memory" title="Add a memory" aria-pressed={adding()} data-action="memory-add" onClick={() => setAdding(!adding())}>
					<Plus size={15} strokeWidth={1.75} />
				</button>
			</div>
			<Show when={adding()}>
				<form
					class="flex flex-col gap-2 rounded-md bg-secondary p-2"
					data-component="memory-note"
					onSubmit={(e) => {
						e.preventDefault()
						const input = e.currentTarget.elements.namedItem("note") as HTMLInputElement
						if (!input.value.trim()) return
						void props.store.note(input.value)
						input.value = ""
						setAdding(false)
					}}
				>
					<input
						name="note"
						class="h-7 min-w-0 bg-transparent px-1 text-md text-foreground outline-none placeholder:text-muted-foreground"
						placeholder="Tell Kiko something to remember"
						aria-label="Add a memory"
						maxLength={280}
						autofocus
						ref={(el) => queueMicrotask(() => el.focus())}
						onKeyDown={(e) => {
							if (e.key !== "Escape") return
							e.stopPropagation()
							setAdding(false)
						}}
					/>
				</form>
			</Show>
			<div class="flex flex-col">
				<For each={shown()}>{(l) => <Line line={l} store={props.store} />}</For>
			</div>
			<Show when={!query().trim() && s().next !== null}>
				<button type="button" class={`${quiet} self-center`} onClick={() => void props.store.more()}>
					Show older
				</button>
			</Show>
			<Show when={s().loaded && query().trim() && !shown().length}>
				<p class="px-2 py-6 text-center text-sm text-muted-foreground">Nothing matches "{query().trim()}"</p>
			</Show>
			<Show when={s().loaded && !query().trim() && !s().lines.length}>
				<div class="flex flex-col gap-1 px-6 py-8 text-center">
					<p class="text-md text-foreground">Nothing remembered yet</p>
					<p class="text-sm text-muted-foreground">Talk to Kiko about people, places, and how you like things done. It keeps the lasting parts here.</p>
				</div>
			</Show>
			<div class="flex flex-col gap-1 border-t border-border pt-2">
				<Show when={!query().trim() && s().view.length}>
					<section class="flex flex-col" data-component="memory-view">
						<button type="button" class="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-accent" aria-expanded={reading()} onClick={() => setReading(!reading())}>
							<span class="flex-1 text-sm text-muted-foreground">What every agent reads</span>
							<span class="text-sm text-foreground">{s().view.length} lines</span>
							<ChevronDown size={13} strokeWidth={1.75} class={`text-muted-foreground ${reading() ? "rotate-180" : ""}`} />
						</button>
						<Show when={reading()}>
							<div class="flex flex-col px-2 py-1">
								<For each={s().view}>{(t) => <ViewLine text={t} store={props.store} />}</For>
							</div>
						</Show>
					</section>
				</Show>
				<MemoryModelRow store={props.store} />
			</div>
		</nav>
	)
}

export function MemoryError(props: { store: MemoryStore }) {
	return (
		<Show when={props.store.state.error}>
			<p class="rounded-md bg-error-surface px-3 py-2 text-sm text-error" role="alert" data-component="memory-error">
				{props.store.state.error}{" "}
				<button type="button" class="underline" onClick={() => props.store.dismissError()}>
					Dismiss
				</button>
			</p>
		</Show>
	)
}

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
