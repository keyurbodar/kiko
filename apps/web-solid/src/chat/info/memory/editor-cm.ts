// The CodeMirror editor for one record body. This file is the only importer of
// CodeMirror, and `editor.tsx` loads it with a dynamic import, so the library sits in
// its own chunk and loads on edit intent (architecture 19.3, tier 4).

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, placeholder } from "@codemirror/view"

export type Mounted = { value(): string; focus(): void; destroy(): void }

const theme = EditorView.theme({
	"&": { height: "100%", backgroundColor: "transparent", color: "var(--text)", fontSize: "14px" },
	".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6", overflow: "auto" },
	".cm-content": { caretColor: "var(--text)", padding: "0" },
	"&.cm-focused": { outline: "none" },
	".cm-cursor": { borderLeftColor: "var(--text)" },
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--selected-bg)" },
	".cm-placeholder": { color: "var(--text-muted)" },
})

export function mountEditor(parent: HTMLElement, doc: string, onChange: (value: string) => void): Mounted {
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc,
			extensions: [
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				EditorView.lineWrapping,
				placeholder("one fact per line, like - 2026-10-02: likes tea"),
				theme,
				EditorView.updateListener.of((u) => {
					if (u.docChanged) onChange(u.state.doc.toString())
				}),
			],
		}),
	})
	return { value: () => view.state.doc.toString(), focus: () => view.focus(), destroy: () => view.destroy() }
}
