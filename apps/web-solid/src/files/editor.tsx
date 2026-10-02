import type { FileRef } from "@kiko/protocol"
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { useCommands } from "../commands/registry"
import { putFile, readFile, sha256Hex } from "./api"
import type { Mounted } from "./editor-cm"
import "./editor.css"

/*
 * The text view for one room file: CodeMirror, read-only until the reader turns on edit. The
 * room's file index is the source of truth for which version exists; this component keeps the
 * version it started from (`base`) and sends its SHA-256 with every save. The server refuses a
 * save whose base is stale, so another writer's content is never overwritten. A refusal, or an
 * index change while the text is dirty, shows a conflict bar and leaves the user's text alone.
 */

export type IndexChange = "none" | "reload" | "conflict"

/**
 * What a new version in the room's index means for an open file. `known` is every version this
 * editor loaded or wrote itself, so its own save coming back as an event changes nothing.
 */
export function onIndexChange(known: ReadonlySet<string>, latestId: string | undefined, dirty: boolean): IndexChange {
	if (latestId === undefined || known.has(latestId)) return "none"
	return dirty ? "conflict" : "reload"
}

type Base = { id: string; sha256: string }
type State = "loading" | "clean" | "dirty" | "saving" | "conflict" | "error"

export function TextEditor(props: {
	roomId: string
	path: string
	/** The file as the index has it now. Undefined once it is removed. */
	file: FileRef | undefined
	/** The first version to show. */
	initial: FileRef
	/** False shows the text read-only. */
	editing: boolean
	/** How to show clean text while read-only, for example formatted JSON. Editing shows the bytes. */
	pretty?: (text: string) => string
}) {
	let host!: HTMLDivElement
	let cm: Mounted | undefined
	let base: Base | undefined
	let raw = ""
	const known = new Set<string>()
	const [state, setState] = createSignal<State>("loading")
	const [theirs, setTheirs] = createSignal<FileRef | null>(null)
	const [message, setMessage] = createSignal("")
	const type = () => (props.initial.type === "application/octet-stream" ? "text/plain" : props.initial.type)
	/** What the editor should hold for clean text in the current mode. */
	const shown = (text: string) => (!props.editing && props.pretty ? props.pretty(text) : text)

	async function load(file: FileRef) {
		setState("loading")
		try {
			const { text, sha256 } = await readFile(props.roomId, file.id)
			base = { id: file.id, sha256 }
			raw = text
			known.add(file.id)
			if (!cm) {
				const { mountEditor } = await import("./editor-cm")
				if (!host.isConnected) return
				cm = mountEditor(host, shown(text), { path: props.path, readOnly: !props.editing, onChange: markDirty })
			} else cm.setValue(shown(text))
			setTheirs(null)
			setState("clean")
		} catch (e) {
			setMessage(e instanceof Error ? e.message : "could not load the file")
			setState("error")
		}
	}

	function markDirty() {
		// Typing during a save or a conflict keeps that state. The save result decides the rest.
		if (state() === "clean" && props.editing) setState("dirty")
	}

	async function save() {
		if (!cm || !base || state() === "saving" || state() === "loading") return
		const text = cm.value()
		setState("saving")
		const res = await putFile(props.roomId, props.path, text, type(), base.sha256)
		if (res.kind === "saved") {
			base = { id: res.file.id, sha256: await sha256Hex(new TextEncoder().encode(text)) }
			raw = text
			known.add(res.file.id)
			// Typing that landed while the request was out is a new edit on the saved version.
			setState(cm.value() === text ? "clean" : "dirty")
		} else if (res.kind === "conflict") {
			setTheirs(res.theirs)
			setState("conflict")
		} else {
			setMessage(res.message)
			setState("error")
		}
	}

	/** Gives up the user's text for the other writer's. */
	const loadTheirs = () => {
		const t = theirs()
		if (t) void load(t)
	}

	/** Writes the user's text over the other writer's, on purpose, against the version they wrote. */
	async function overwrite() {
		const t = theirs()
		if (!cm || !t) return
		setState("saving")
		try {
			const { sha256 } = await readFile(props.roomId, t.id)
			base = { id: t.id, sha256 }
			known.add(t.id)
		} catch {
			setState("conflict")
			return
		}
		// `save` refuses while saving, so step out of that state first.
		setState("dirty")
		await save()
		if (state() === "clean" || state() === "dirty") setTheirs(null)
	}

	onMount(() => void load(props.initial))
	onCleanup(() => cm?.destroy())

	// Mod+S inside the editor saves. It is caught on the window in the capture phase, before the
	// hotkey library sees it, so the same key does not also toggle the sidebar.
	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "s") return
			if (!(e.target instanceof Node) || !host.contains(e.target)) return
			e.preventDefault()
			e.stopImmediatePropagation()
			void save()
		}
		window.addEventListener("keydown", onKey, true)
		onCleanup(() => window.removeEventListener("keydown", onKey, true))
	})

	// Edit on and off. Clean text swaps between its pretty and raw forms; unsaved text stays as typed.
	createEffect(
		on(
			() => props.editing,
			(editing) => {
				if (!cm) return
				cm.setReadOnly(!editing)
				if (state() === "clean") cm.setValue(shown(raw))
				if (editing) cm.focus()
			},
			{ defer: true },
		),
	)

	// A new version in the index while this file is open.
	createEffect(
		on(
			() => props.file?.id,
			(latestId) => {
				if (state() === "loading" || state() === "saving") return
				const change = onIndexChange(known, latestId, state() !== "clean")
				if (change === "reload" && props.file) void load(props.file)
				if (change === "conflict" && props.file) {
					setTheirs(props.file)
					setState("conflict")
				}
			},
			{ defer: true },
		),
	)

	// In the palette. The key is caught above, inside the editor only.
	useCommands([
		{
			id: "files.save",
			title: "file: save",
			group: "view",
			icon: "save",
			when: () => state() === "dirty" || state() === "error",
			run: () => void save(),
		},
	])

	const bar = () => props.editing || state() === "conflict" || state() === "error" || state() === "dirty"

	return (
		<div class="file-editor" data-component="file-editor" data-state={state()} data-editing={props.editing ? "" : undefined}>
			<div class="fe-body" ref={host} />
			<Show when={bar()}>
				<footer class="fe-bar">
					<Show when={state() === "conflict"}>
						<span class="fe-warn" role="alert" data-component="file-conflict">
							{theirs() ? "someone else changed this file" : "this file was removed"}
						</span>
						<Show when={theirs()}>
							<button type="button" class="fe-btn" onClick={loadTheirs}>
								load theirs
							</button>
							<button type="button" class="fe-btn" onClick={() => void overwrite()}>
								overwrite
							</button>
						</Show>
						<button type="button" class="fe-btn" onClick={() => setState("dirty")}>
							keep editing
						</button>
					</Show>
					<Show when={state() === "error"}>
						<span class="fe-warn" role="alert">
							{message()}
						</span>
					</Show>
					<span class="fe-status" data-component="file-status">
						{{ loading: "loading...", clean: "saved", dirty: "unsaved changes", saving: "saving...", conflict: "", error: "not saved" }[state()]}
					</span>
					<button type="button" class="fe-btn fe-save" data-action="save" disabled={state() !== "dirty" && state() !== "error"} onClick={() => void save()}>
						save
					</button>
				</footer>
			</Show>
		</div>
	)
}
