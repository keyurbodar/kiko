import { lift, setBlockType, toggleMark, wrapIn } from "@tiptap/pm/commands"
import type { NodeType, Schema } from "@tiptap/pm/model"
import { liftListItem, wrapInList } from "@tiptap/pm/schema-list"
import type { Command, EditorState } from "@tiptap/pm/state"

export type Binding = { key: string; label: string; command: (schema: Schema) => Command }

/** Opens the link input. It is not a table command because it needs the editor's `onLink`. */
export const LINK_KEY = "Mod-k"

export const BINDINGS: readonly Binding[] = [
  { key: "Mod-b", label: "bold", command: (s) => toggleMark(s.marks.bold!) },
  { key: "Mod-i", label: "italic", command: (s) => toggleMark(s.marks.italic!) },
  { key: "Mod-Shift-x", label: "strikethrough", command: (s) => toggleMark(s.marks.strike!) },
  { key: "Mod-e", label: "inline code", command: (s) => toggleMark(s.marks.code!) },
  { key: "Mod-Shift-8", label: "bullet list", command: (s) => toggleList(s.nodes.bulletList!, s.nodes.listItem!) },
  { key: "Mod-Shift-7", label: "numbered list", command: (s) => toggleList(s.nodes.orderedList!, s.nodes.listItem!) },
  { key: "Mod-Shift-b", label: "quote", command: (s) => toggleWrap(s.nodes.blockquote!) },
  { key: "Mod-Alt-c", label: "code block", command: (s) => toggleCodeBlock(s.nodes.codeBlock!, s.nodes.paragraph!) },
]

function ancestor(state: EditorState, test: (type: NodeType) => boolean) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (test(node.type)) return { node, depth }
  }
  return null
}

function toggleList(list: NodeType, item: NodeType): Command {
  return (state, dispatch) => {
    const inside = ancestor(state, (type) => type === list || type === state.schema.nodes.bulletList || type === state.schema.nodes.orderedList)
    if (!inside) return wrapInList(list)(state, dispatch)
    if (inside.node.type === list) return liftListItem(item)(state, dispatch)
    if (dispatch) dispatch(state.tr.setNodeMarkup(state.selection.$from.before(inside.depth), list, inside.node.type === state.schema.nodes.orderedList ? {} : { start: 1 }))
    return true
  }
}

function toggleWrap(type: NodeType): Command {
  return (state, dispatch) => (ancestor(state, (t) => t === type) ? lift(state, dispatch) : wrapIn(type)(state, dispatch))
}

function toggleCodeBlock(code: NodeType, paragraph: NodeType): Command {
  return (state, dispatch) => setBlockType(state.selection.$from.parent.type === code ? paragraph : code)(state, dispatch)
}
