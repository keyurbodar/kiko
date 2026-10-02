// The CodeMirror editor for one file. This file is the only importer of CodeMirror here, and
// `editor.tsx` loads it with a dynamic import, so the library sits in its own chunk and loads
// when a text file opens (architecture 19.3, tier 4). Only the extensions the files route uses.

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { EditorState, type Extension } from "@codemirror/state"
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view"

export type Mounted = { value(): string; setValue(text: string): void; focus(): void; destroy(): void }

// Kat tokens only. The current line is a wash, the gutter is muted.
const theme = EditorView.theme({
	"&": { height: "100%", backgroundColor: "transparent", color: "var(--text)", fontSize: "13px" },
	".cm-scroller": { fontFamily: "var(--font-family-mono)", lineHeight: "1.5", overflow: "auto" },
	".cm-content": { caretColor: "var(--text)", padding: "8px 0" },
	"&.cm-focused": { outline: "none" },
	".cm-cursor": { borderLeftColor: "var(--text)" },
	".cm-gutters": { backgroundColor: "transparent", color: "var(--text-muted)", border: "none" },
	".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px", minWidth: "40px" },
	".cm-activeLine": { backgroundColor: "var(--hover-bg)" },
	".cm-activeLineGutter": { backgroundColor: "var(--hover-bg)", color: "var(--text)" },
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--selected-bg)" },
	".cm-selectionMatch": { backgroundColor: "var(--selected-bg)" },
	".cm-searchMatch": { backgroundColor: "var(--accent-wash)", outline: "1px solid var(--accent)" },
	".cm-panels": { backgroundColor: "var(--input-bg)", color: "var(--text)", fontFamily: "var(--font-family-sans)" },
	".cm-panels-bottom": { borderTop: "none" },
	".cm-panel input, .cm-panel button": { font: "inherit", color: "inherit" },
	".cm-textfield": { backgroundColor: "transparent", border: "1px solid var(--selected-bg)", borderRadius: "6px" },
	".cm-button": { backgroundImage: "none", backgroundColor: "var(--hover-bg)", border: "none", borderRadius: "6px" },
})

export function mountEditor(parent: HTMLElement, doc: string, onChange: () => void): Mounted {
	const extensions: Extension[] = [
		lineNumbers(),
		highlightActiveLine(),
		highlightActiveLineGutter(),
		drawSelection(),
		highlightSelectionMatches(),
		history(),
		keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
		theme,
		EditorView.updateListener.of((u) => {
			if (u.docChanged) onChange()
		}),
	]
	const view = new EditorView({ parent, state: EditorState.create({ doc, extensions }) })
	return {
		value: () => view.state.doc.toString(),
		// A whole new version. The state is rebuilt, so undo never walks back into the old file.
		setValue: (text) => view.setState(EditorState.create({ doc: text, extensions })),
		focus: () => view.focus(),
		destroy: () => view.destroy(),
	}
}
