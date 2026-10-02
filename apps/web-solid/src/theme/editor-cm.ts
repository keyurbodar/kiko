// The CodeMirror editor for theme JSON. This file is the only importer of CodeMirror in the
// theme code, and `editor.tsx` loads it with a dynamic import, so the library sits in its
// own chunk and loads on intent (architecture 19.3, tier 4).

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"

export type Mounted = { set(value: string): void; focus(): void; destroy(): void }

const look = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--text)", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--font-family-mono)", lineHeight: "1.5", overflow: "auto" },
  ".cm-content": { caretColor: "var(--text)", padding: "0" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-faint)", border: "none" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--selected-bg)" },
})

export function mountJsonEditor(parent: HTMLElement, doc: string, onChange: (value: string) => void): Mounted {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        lineNumbers(),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        look,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString())
        }),
      ],
    }),
  })
  return {
    set(value) {
      if (view.state.doc.toString() === value) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
