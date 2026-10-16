import type { LifeLine } from "@kiko/protocol"
import { ArrowUp, ChevronDown, Search } from "lucide-solid"
import { createResource, createSignal, For, Show } from "solid-js"
import { ModelPicker } from "../../../settings/model-picker"
import { session } from "../../../app/session"
import { memoryFor } from "./instance"
import { ago, groupLines, replacedMark, sourceOf } from "./lines"
import type { MemoryStore } from "./store"


const quiet = "rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function Line(props: { line: LifeLine; store: MemoryStore }) {
	const l = () => props.line
	const [open, setOpen] = createSignal(false)
	const [sure, setSure] = createSignal(false)
	return (
		<div class="border-b border-border last:border-b-0" data-component="memory-line" data-pos={l().pos} data-pinned={l().pinned ? "" : undefined}>
			<button type="button" class="flex h-9 w-full items-center gap-3 px-1 text-left hover:bg-accent" aria-expanded={open()} onClick={() => setOpen(!open())}>
				<span class={`min-w-0 flex-1 truncate text-md ${replacedMark(l()) ? "text-muted-foreground line-through" : "text-foreground"}`}>{sentence(l().text)}</span>
				<span class="shrink-0 text-xs tabular-nums text-secondary-label">{ago(l().at)}</span>
			</button>
			<Show when={open()}>
				<div class="flex flex-col gap-2 px-1 pb-2.5">
					<p class="text-md leading-relaxed text-muted-foreground">{sentence(l().text)}</p>
					<div class="flex items-center gap-1 text-xs text-secondary-label">
						<span class="flex-1">
							From {sourceOf(l())}
							<Show when={replacedMark(l())}>{(mark) => <> · {mark()}</>}</Show>
						</span>
						<Show when={l().pos >= 0}>
							<button type="button" class={quiet} data-action="pin" onClick={() => props.store.pin(l().pos, !l().pinned)}>
								{l().pinned ? "Unpin" : "Pin"}
							</button>
							<button
								type="button"
								class={`${quiet} ${sure() ? "text-error hover:text-error" : ""}`}
								data-action="redact"
								onClick={() => (sure() ? props.store.redact(l().pos) : setSure(true))}
								onBlur={() => setSure(false)}
							>
								{sure() ? "Remove for good" : "Remove"}
							</button>
						</Show>
					</div>
				</div>
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
	const current = () => {
		const m = props.store.state.model
		return m ? `${m.provider}/${m.modelId}` : undefined
	}
	return (
		<div class="flex h-8 items-center gap-2 px-1" data-component="memory-model">
			<span class="flex-1 text-sm text-muted-foreground">Summaries written by</span>
			<ModelPicker
				current={current()}
				open={open()}
				onOpenChange={setOpen}
				onPick={(ref) => {
					const at = ref.indexOf("/")
					void props.store.setModel({ provider: ref.slice(0, at), modelId: ref.slice(at + 1) })
				}}
				class="max-w-44 truncate rounded-md px-1.5 py-0.5 text-sm text-foreground hover:bg-accent"
			>
				{current()?.split("/").slice(1).join("/") ?? "Default model"}
			</ModelPicker>
			<Show when={current()}>
				<button type="button" class={quiet} onClick={() => void props.store.setModel(null)}>
					Reset
				</button>
			</Show>
		</div>
	)
}

export function MemoryList(props: { store: MemoryStore }) {
	const [query, setQuery] = createSignal("")
	const [reading, setReading] = createSignal(false)
	const s = () => props.store.state
	const searching = () => query().trim() !== ""
	const groups = () => (searching() ? [{ title: "Results", lines: s().results ?? [] }] : groupLines(s().lines))
	const search = (value: string) => {
		setQuery(value)
		void props.store.search(value)
	}
	return (
		<nav class="flex min-h-full flex-col gap-4" aria-label="Memory" data-component="memory-list">
			<label class="sticky top-0 z-10 flex h-8 items-center gap-2 rounded-lg bg-secondary px-2.5 text-muted-foreground focus-within:text-foreground">
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
			<For each={groups()}>
				{(group) => (
					<section class="flex flex-col" data-group={group.title}>
						<h3 class="px-1 pb-1 text-xs font-medium text-muted-foreground">{group.title}</h3>
						<div class="flex flex-col border-t border-border">
							<For each={group.lines}>{(l) => <Line line={l} store={props.store} />}</For>
						</div>
					</section>
				)}
			</For>
			<Show when={!searching() && s().next !== null}>
				<button type="button" class={`${quiet} self-center`} onClick={() => void props.store.more()}>
					Show older
				</button>
			</Show>
			<Show when={s().loaded && searching() && !(s().results ?? []).length}>
				<p class="px-1 py-6 text-center text-sm text-muted-foreground">Nothing matches "{query().trim()}"</p>
			</Show>
			<Show when={s().loaded && !searching() && !s().lines.length}>
				<div class="flex flex-col gap-1 px-4 py-8 text-center">
					<p class="text-md text-foreground">Nothing remembered yet</p>
					<p class="text-sm text-muted-foreground">Talk to Kiko about people, places, and how you like things done. It keeps the lasting parts here.</p>
				</div>
			</Show>
			<div class="mt-auto flex flex-col gap-2 pt-2">
				<Show when={!searching() && s().view.length}>
					<section class="flex flex-col" data-component="memory-view">
						<button type="button" class="flex h-8 items-center gap-2 px-1 text-left text-sm text-muted-foreground hover:text-foreground" aria-expanded={reading()} onClick={() => setReading(!reading())}>
							<span class="flex-1">What every agent reads</span>
							<span>{s().view.length} lines</span>
							<ChevronDown size={13} strokeWidth={1.75} class={reading() ? "rotate-180" : ""} />
						</button>
						<Show when={reading()}>
							<div class="flex flex-col px-1 py-1">
								<For each={s().view}>{(t) => <ViewLine text={t} store={props.store} />}</For>
							</div>
						</Show>
					</section>
				</Show>
				<MemoryModelRow store={props.store} />
				<form
					class="flex h-10 items-center gap-2 rounded-full border border-border bg-secondary pr-1 pl-4"
					data-component="memory-note"
					onSubmit={(e) => {
						e.preventDefault()
						const input = e.currentTarget.elements.namedItem("note") as HTMLInputElement
						if (!input.value.trim()) return
						void props.store.note(input.value)
						input.value = ""
					}}
				>
					<input name="note" class="min-w-0 flex-1 bg-transparent text-md text-foreground outline-none placeholder:text-muted-foreground" placeholder="Tell Kiko something to remember" aria-label="Add a memory" maxLength={280} />
					<button type="submit" class="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-label="Remember">
						<ArrowUp size={15} strokeWidth={2} />
					</button>
				</form>
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
