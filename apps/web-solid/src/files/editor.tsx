import type { FileRef } from "@kiko/protocol"
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { putFile, readFile, sha256Hex } from "./api"
import type { Mounted } from "./editor-cm"
import "./editor.css"

/*
 * The text editor for one room file: CodeMirror, always editable, with autosave. An edit saves
 * itself AUTOSAVE_MS after the last keystroke, and at once when the editor loses focus or
 * closes, so there is no save button and nothing to forget. The room's file index is the source
 * of truth for which version exists; this component keeps the version it started from (`base`)
 * and sends its SHA-256 with every save. The server refuses a save whose base is stale, so
 * another writer's content is never overwritten. A refusal, or an index change while the text is
 * dirty, shows a conflict bar and leaves the user's text alone.
 */

/** Quiet time after the last keystroke before an edit saves itself. */
export const AUTOSAVE_MS = 700

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
export type EditorState = "loading" | "clean" | "dirty" | "saving" | "conflict" | "error"
type State = EditorState

export function TextEditor(props: {
	roomId: string
	path: string
	/** The file as the index has it now. Undefined once it is removed. */
	file: FileRef | undefined
	/** The first version to show. */
	initial: FileRef
	/** Told every state change, so the header can show an unsaved dot. */
	onState?: (state: EditorState) => void
}) {
	let host!: HTMLDivElement
	let cm: Mounted | undefined
	let base: Base | undefined
	const known = new Set<string>()
	const [state, setState] = createSignal<State>("loading")
	const [theirs, setTheirs] = createSignal<FileRef | null>(null)
	const [message, setMessage] = createSignal("")
	const type = () => (props.initial.type === "application/octet-stream" ? "text/plain" : props.initial.type)
	let timer: ReturnType<typeof setTimeout> | undefined
	let gone = false
	createEffect(() => props.onState?.(state()))

	async function load(file: FileRef) {
		setState("loading")
		try {
			const { text, sha256 } = await readFile(props.roomId, file.id)
			base = { id: file.id, sha256 }
			known.add(file.id)
			if (!cm) {
				const { mountEditor } = await import("./editor-cm")
				if (!host.isConnected) return
				cm = mountEditor(host, text, { path: props.path, readOnly: false, onChange: markDirty, onBlur: flush })
			} else cm.setValue(text)
			setTheirs(null)
			setState("clean")
		} catch (e) {
			setMessage(e instanceof Error ? e.message : "could not load the file")
			setState("error")
		}
	}

	function markDirty() {
		// Typing during a save or a conflict keeps that state. The save result decides the rest.
		if (state() === "clean") setState("dirty")
		if (state() !== "conflict" && state() !== "loading") schedule()
	}

	function schedule() {
		clearTimeout(timer)
		timer = setTimeout(flush, AUTOSAVE_MS)
	}

	/** Saves now if there is anything to save. Safe to call at any time. */
	function flush() {
		clearTimeout(timer)
		timer = undefined
		if (state() === "dirty" || state() === "error") void save()
	}

	async function save(text = cm?.value()) {
		if (text === undefined || !base || state() === "saving" || state() === "loading") return
		setState("saving")
		const res = await putFile(props.roomId, props.path, text, type(), base.sha256)
		if (res.kind === "saved") {
			base = { id: res.file.id, sha256: await sha256Hex(new TextEncoder().encode(text)) }
			known.add(res.file.id)
			if (gone) return
			// Typing that landed while the request was out is a new edit on the saved version.
			const later = cm !== undefined && cm.value() !== text
			setState(later ? "dirty" : "clean")
			if (later) schedule()
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
	// Closing the file, switching to the rendered view or leaving the chat saves what is typed.
	onCleanup(() => {
		clearTimeout(timer)
		const text = cm?.value()
		gone = true
		if (text !== undefined && (state() === "dirty" || state() === "error")) void save(text)
		cm?.destroy()
		cm = undefined
	})

	// Mod+S inside the editor saves at once, out of habit. It is caught on the window in the
	// capture phase, before the hotkey library sees it, so it does not also toggle the sidebar.
	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "s") return
			if (!(e.target instanceof Node) || !host.contains(e.target)) return
			e.preventDefault()
			e.stopImmediatePropagation()
			flush()
		}
		window.addEventListener("keydown", onKey, true)
		onCleanup(() => window.removeEventListener("keydown", onKey, true))
	})

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

	// The bar shows only when a human has to decide something.
	const bar = () => state() === "conflict" || state() === "error"

	return (
		<div class="file-editor" data-component="file-editor" data-state={state()}>
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
						<button type="button" class="fe-btn" data-action="retry-save" onClick={flush}>
							try again
						</button>
					</Show>
				</footer>
			</Show>
		</div>
	)
}
