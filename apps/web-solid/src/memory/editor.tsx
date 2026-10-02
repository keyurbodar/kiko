import { createSignal, onCleanup, onMount } from "solid-js"
import type { Mounted } from "./editor-cm"

/** Starts loading CodeMirror. Call it on hover or focus of an edit control. */
export const preloadEditor = () => import("./editor-cm")

/*
 * The record editor. CodeMirror loads on first use, so the viewer paints without it.
 * Until it arrives a plain textarea holds the text, so the click that opened the editor
 * never waits on the network, and what the person typed is carried over.
 */
export function Editor(props: { value: string; onChange: (value: string) => void }) {
	let host!: HTMLDivElement
	let area!: HTMLTextAreaElement
	const [ready, setReady] = createSignal(false)
	let mounted: Mounted | undefined
	let latest = props.value
	let gone = false

	onMount(() => {
		area.focus()
		void preloadEditor().then(({ mountEditor }) => {
			if (gone) return
			mounted = mountEditor(
				host,
				latest,
				(v) => {
					latest = v
					props.onChange(v)
				},
			)
			setReady(true)
			mounted.focus()
		})
	})
	onCleanup(() => {
		gone = true
		mounted?.destroy()
	})

	return (
		<div class="min-h-0 flex-1 overflow-auto rounded-lg bg-input p-3" data-component="memory-editor">
			<textarea
				ref={area}
				class="h-full min-h-48 w-full resize-none bg-transparent text-sm leading-relaxed text-text outline-none"
				classList={{ hidden: ready() }}
				aria-label="record body"
				value={props.value}
				onInput={(e) => {
					latest = e.currentTarget.value
					props.onChange(latest)
				}}
			/>
			<div ref={host} classList={{ hidden: !ready() }} class="h-full min-h-48" />
		</div>
	)
}
