// The CodeMirror editor for one file. This file is the only importer of CodeMirror here, and
// `editor.tsx` loads it with a dynamic import, so the library sits in its own chunk and loads
// when a text file opens (architecture 19.3, tier 4). Only the extensions the file viewer uses.
//
// Highlighting reuses sugar-high, the highlighter the chat's code blocks already load, so the
// app has one tokenizer and no CodeMirror language packages.

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { Compartment, EditorState, RangeSetBuilder, type Extension } from "@codemirror/state"
import {
	Decoration,
	type DecorationSet,
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view"
import { SugarHigh, tokenize } from "sugar-high/core"
import { lang, languages } from "sugar-high/lang"

export type Mounted = {
	value(): string
	setValue(text: string): void
	setReadOnly(readOnly: boolean): void
	focus(): void
	destroy(): void
}

// Kat tokens only. The current line is a wash, the gutter is muted.
const theme = EditorView.theme({
	"&": { height: "100%", backgroundColor: "transparent", color: "var(--text)", fontSize: "12.5px" },
	".cm-scroller": { fontFamily: "var(--font-family-mono)", lineHeight: "1.6", overflow: "auto" },
	".cm-content": { caretColor: "var(--text)", padding: "8px 0" },
	"&.cm-focused": { outline: "none" },
	".cm-cursor": { borderLeftColor: "var(--text)" },
	".cm-gutters": { backgroundColor: "transparent", color: "var(--text-faint)", border: "none" },
	".cm-lineNumbers .cm-gutterElement": { padding: "0 16px 0 8px", minWidth: "40px" },
	".cm-activeLine": { backgroundColor: "var(--hover-bg)" },
	".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
	"&.cm-readonly .cm-activeLine": { backgroundColor: "transparent" },
	"&.cm-readonly .cm-cursor": { display: "none" },
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--selected-bg)" },
	".cm-selectionMatch": { backgroundColor: "var(--selected-bg)" },
	".cm-searchMatch": { backgroundColor: "var(--accent-wash)", outline: "1px solid var(--accent)" },
	".cm-panels": { backgroundColor: "var(--input-bg)", color: "var(--text)", fontFamily: "var(--font-family-sans)" },
	".cm-panels-bottom": { borderTop: "none" },
	".cm-panel input, .cm-panel button": { font: "inherit", color: "inherit" },
	".cm-textfield": { backgroundColor: "transparent", border: "none", boxShadow: "inset 0 0 0 1px var(--selected-bg)", borderRadius: "6px" },
	".cm-button": { backgroundImage: "none", backgroundColor: "var(--hover-bg)", border: "none", borderRadius: "6px" },
})

/** Past this many characters a file is shown plain, so a huge log never stalls a keystroke. */
const MAX_HIGHLIGHT_CHARS = 200_000
const PLAIN = new Set(["identifier", "space", "break"])
const marks = new Map<string, Decoration>()
const mark = (type: string) => {
	let m = marks.get(type)
	if (!m) marks.set(type, (m = Decoration.mark({ attributes: { style: `color: var(--sh-${type})` } })))
	return m
}

/** The sugar-high language for a file name, by extension. Undefined means plain text. */
export function languageOf(path: string) {
	const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()
	const name = ext ? lang(ext) : undefined
	if (!name || name === "plaintext") return undefined
	return languages.find((l) => l.id === name)
}

function highlighter(path: string): Extension {
	const language = languageOf(path)
	if (!language) return []
	const build = (text: string): DecorationSet => {
		const builder = new RangeSetBuilder<Decoration>()
		if (text.length > MAX_HIGHLIGHT_CHARS) return builder.finish()
		let at = 0
		for (const [type, value] of tokenize(text, language.config)) {
			const name = SugarHigh.TokenTypes[type] ?? "identifier"
			if (value && !PLAIN.has(name)) builder.add(at, at + value.length, mark(name))
			at += value.length
		}
		return builder.finish()
	}
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet
			constructor(view: EditorView) {
				this.decorations = build(view.state.doc.toString())
			}
			update(u: ViewUpdate) {
				if (u.docChanged) this.decorations = build(u.state.doc.toString())
			}
		},
		{ decorations: (v) => v.decorations },
	)
}

export function mountEditor(
	parent: HTMLElement,
	doc: string,
	opts: { path: string; readOnly: boolean; onChange: () => void; onBlur?: () => void },
): Mounted {
	const editable = new Compartment()
	const lock = (readOnly: boolean) => [
		EditorState.readOnly.of(readOnly),
		EditorView.editable.of(!readOnly),
		EditorView.editorAttributes.of({ class: readOnly ? "cm-readonly" : "" }),
	]
	const extensions: Extension[] = [
		lineNumbers(),
		highlightActiveLine(),
		highlightActiveLineGutter(),
		drawSelection(),
		highlightSelectionMatches(),
		history(),
		keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
		theme,
		highlighter(opts.path),
		EditorView.updateListener.of((u) => {
			if (u.docChanged) opts.onChange()
		}),
		EditorView.domEventHandlers({
			blur: () => {
				opts.onBlur?.()
			},
		}),
	]
	let readOnly = opts.readOnly
	const state = (text: string) => EditorState.create({ doc: text, extensions: [...extensions, editable.of(lock(readOnly))] })
	const view = new EditorView({ parent, state: state(doc) })
	return {
		value: () => view.state.doc.toString(),
		// A whole new version. The state is rebuilt, so undo never walks back into the old file.
		setValue: (text) => view.setState(state(text)),
		setReadOnly: (value) => {
			readOnly = value
			view.dispatch({ effects: editable.reconfigure(lock(value)) })
		},
		focus: () => view.focus(),
		destroy: () => view.destroy(),
	}
}
