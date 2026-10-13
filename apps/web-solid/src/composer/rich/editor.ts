import "./rich.css"
import { Editor, Extension, InputRule, wrappingInputRule } from "@tiptap/core"
import { Blockquote } from "@tiptap/extension-blockquote"
import { Bold } from "@tiptap/extension-bold"
import { Code } from "@tiptap/extension-code"
import { CodeBlock } from "@tiptap/extension-code-block"
import { Document } from "@tiptap/extension-document"
import { HardBreak } from "@tiptap/extension-hard-break"
import { Heading } from "@tiptap/extension-heading"
import { HorizontalRule } from "@tiptap/extension-horizontal-rule"
import { Italic } from "@tiptap/extension-italic"
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Strike } from "@tiptap/extension-strike"
import { TaskItem } from "@tiptap/extension-task-item"
import { TaskList } from "@tiptap/extension-task-list"
import { Text } from "@tiptap/extension-text"
import { UndoRedo } from "@tiptap/extensions"
import { keymap } from "@tiptap/pm/keymap"
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model"
import { EditorState, Plugin, Selection, TextSelection, type Command, type Transaction } from "@tiptap/pm/state"
import { BINDINGS, LINK_KEY } from "./keymap"
import { docToMarkdown, markdownToDoc, type Json } from "./markdown"
import { chipExtension, Link, Mention, setChipStatus, type ChipStatus } from "./nodes"
import { groupUndoByChangeKind, UNDO_GROUP_DELAY, type ChangeKind } from "./undo-grouping"

export type Snapshot = { markdown: string; plain: string; cursor: number }

export type RichOptions = {
  element: HTMLElement
  markdown: string
  label: string
  isMention: (slug: string) => boolean
  onChange: (snapshot: Snapshot) => void
  onCursor: (cursor: number) => void
  onChips: (ids: string[]) => void
  onKeyDown: (event: KeyboardEvent) => boolean
  onPaste: (event: ClipboardEvent) => boolean
  onLink: (href: string | null) => void
  onChipAction: (id: string) => void
  onChipRemove: (id: string) => void
  onFocus: () => void
  onBlur: () => void
}

export type RichEditor = ReturnType<typeof mountRichEditor>

function hasAncestor($pos: any, name: string): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === name) return true
  }
  return false
}

const horizontalRuleInputRule = new InputRule({
  find: /^(---|\*\*\*|___)\s?$/,
  handler: ({ state, range, match, chain }) => {
    const source = match[0] ?? "---"
    if (!source.startsWith("---") && !/\s$/.test(source)) return null
    const $from = state.doc.resolve(range.from)
    if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null
    chain().deleteRange(range).setHorizontalRule().run()
    return undefined
  },
})

const headingInputRule = new InputRule({
  find: /^(#{1,6})(\s)$/,
  handler: ({ state, range, match, chain }) => {
    const $from = state.doc.resolve(range.from)
    if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null
    chain()
      .deleteRange(range)
      .setNode("heading", { level: match[1]?.length ?? 1 })
      .run()
    return undefined
  },
})

const blockquoteInputRule = new InputRule({
  find: /^>(\s)$/,
  handler: ({ state, range, chain }) => {
    const $from = state.doc.resolve(range.from)
    if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null
    chain().deleteRange(range).wrapIn("blockquote").run()
    return undefined
  },
})

function listMarkerInputRule(find: RegExp, listType: "bulletList" | "orderedList"): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range, match, chain }) => {
      const marker = (match.groups?.marker ?? "-") as string
      const space = (match.groups?.space ?? " ") as string
      const carried = (match.groups?.carried ?? "") as string
      const $from = state.doc.resolve(range.from)
      if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null
      const command = chain().deleteRange(range).wrapInList(listType, listType === "orderedList" ? { start: Number.parseInt(marker, 10) || 1 } : {})
      if (carried) command.insertContent(carried)
      command.run()
      return undefined
    },
  })
}


function taskInputRule(type: any): InputRule {
  const rule = wrappingInputRule({
    find: /^- \[([ xX])\] $/,
    type,
    getAttributes: (match: any) => ({ checked: (match[1] ?? " ").toLowerCase() === "x" }),
  })
  return new InputRule({
    find: rule.find,
    handler: (props: any) => (props.state.doc.resolve(props.range.from).depth === 1 ? rule.handler(props) : null),
  })
}

export function mountRichEditor(options: RichOptions) {
  let previousKind: ChangeKind | null = null
  let ids = ""

  const Keys = Extension.create({
    name: "composerKeys",
    priority: 1000,
    addProseMirrorPlugins() {
      const schema = this.editor.schema
      const bindings = Object.fromEntries(BINDINGS.map((binding) => [binding.key, binding.command(schema)]))
      return [
        keymap({
          ...bindings,
          [LINK_KEY]: () => {
            options.onLink(currentLink())
            return true
          },
          // A file chip goes in one press, the way a character does. ProseMirror's own atom
          // selection did not delete it, so the chip is removed here, from the caret's side.
          Backspace: removeChipBeside("before"),
          Delete: removeChipBeside("after"),
        }),
        new Plugin({
          filterTransaction(tr) {
            previousKind = groupUndoByChangeKind(tr, previousKind)
            return true
          },
        }),
      ]
    },
  })

  const editor = new Editor({
    element: options.element,
    content: markdownToDoc(options.markdown, { isMention: options.isMention }),
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      Bold,
      Italic,
      Strike,
      Code,
      Blockquote.extend({
        addInputRules() { return [blockquoteInputRule] },
      }),
      Heading.extend({
        addInputRules() { return [headingInputRule] },
      }),
      HorizontalRule.extend({
        addInputRules() { return [horizontalRuleInputRule] },
      }),
      CodeBlock,
      BulletList.extend({
        addInputRules() {
          return [
            listMarkerInputRule(/^(?<marker>[*+])(?<space>\s)$/, "bulletList"),
            listMarkerInputRule(/^(?<marker>-)(?<space>[ \t]+)(?<carried>[^\s\[])$/, "bulletList"),
          ]
        },
      }),
      OrderedList.extend({
        addInputRules() {
          return [
            listMarkerInputRule(/^(?<marker>\d+[.)])(?<space>\s)$/, "orderedList"),
          ]
        },
      }),
      ListItem,
      TaskList,
      TaskItem.configure({ nested: true }).extend({
        addInputRules() {
          return [taskInputRule(this.type)]
        },
      }),
      UndoRedo.configure({ newGroupDelay: UNDO_GROUP_DELAY }),
      Link,
      Mention,
      chipExtension(options.onChipAction, options.onChipRemove),
      Keys,
    ],
    editorProps: {
      attributes: {
        "data-component": "prompt-input",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": options.label,
        class: "composer-input focus:outline-none",
        autocomplete: "off",
        autocapitalize: "sentences",
        autocorrect: "on",
      },
      handleKeyDown: (_view, event) => options.onKeyDown(event),
      handlePaste: (view, event) => {
        if (options.onPaste(event)) return true
        const text = event.clipboardData?.getData("text/plain")
        if (!text) return true
        event.preventDefault()
        const tr = view.state.tr.replaceSelection(sliceOf(view.state, text)).scrollIntoView().setMeta("uiEvent", "paste")
        view.dispatch(tr)
        return true
      },
      handleDrop: (_view, event) => !!event.dataTransfer?.types.includes("Files"),
    },
    onUpdate: () => {
      options.onChange(snapshot())
      reportChips()
    },
    onSelectionUpdate: () => options.onCursor(snapshot().cursor),
    onFocus: options.onFocus,
    onBlur: options.onBlur,
  })

  function removeChipBeside(side: "before" | "after"): Command {
    return (state, dispatch) => {
      const { selection } = state
      if (!selection.empty) return false
      const chip = side === "before" ? selection.$from.nodeBefore : selection.$from.nodeAfter
      if (chip?.type.name !== "fileChip") return false
      if (dispatch) {
        const start = side === "before" ? selection.from - chip.nodeSize : selection.from
        dispatch(state.tr.delete(start, start + chip.nodeSize))
      }
      // Told here, not only through the change callback: the callback did not report this removal.
      options.onChipRemove(String(chip.attrs.id))
      return true
    }
  }

  function snapshot(): Snapshot {
    const { doc, selection } = editor.state
    const plain = (end: number) => doc.textBetween(0, end, "\n", (leaf) => (leaf.type.name === "mention" ? `@${leaf.attrs.slug}` : ""))
    return { markdown: docToMarkdown(doc.toJSON() as Json), plain: plain(doc.content.size), cursor: plain(selection.from).length }
  }

  function chipIds(): string[] {
    const found: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === "fileChip") found.push(String(node.attrs.id))
    })
    return found
  }

  function reportChips() {
    const now = chipIds()
    const key = now.join("\n")
    if (key === ids) return
    ids = key
    options.onChips(now)
  }

  function sliceOf(state: EditorState, text: string): Slice {
    const { schema, selection } = state
    const lines = text.replace(/\r\n?/g, "\n").split("\n")
    if (selection.$from.parent.type.spec.code) return new Slice(Fragment.from(schema.text(text)), 0, 0)
    const nodes: PMNode[] = []
    lines.forEach((line, index) => {
      if (index > 0) nodes.push(schema.nodes.hardBreak!.create())
      if (line) nodes.push(schema.text(line))
    })
    return new Slice(Fragment.from(nodes), 0, 0)
  }

  function currentLink(): string {
    const { $from } = editor.state.selection
    const mark = editor.state.schema.marks.link!.isInSet($from.marks())
    return mark ? String(mark.attrs.href) : ""
  }

  function linkRange() {
    const { $from } = editor.state.selection
    const type = editor.state.schema.marks.link!
    const start = $from.parent.childAfter($from.parentOffset)
    const mark = type.isInSet($from.marks())
    if (!mark) return null
    let from = $from.start() + start.offset
    let to = from + start.node!.nodeSize
    const before = $from.parent.childBefore($from.parentOffset)
    if (before.node && type.isInSet(before.node.marks)) from = $from.start() + before.offset
    if (!start.node || !type.isInSet(start.node.marks)) to = $from.pos
    return { from, to }
  }

  return {
    dom: editor.view.dom as HTMLElement,
    snapshot,
    focus: () => editor.commands.focus("end", { scrollIntoView: false }),
    isFocused: () => editor.isFocused,
    setEditable: (editable: boolean) => editor.setEditable(editable, false),
    isEditable: () => editor.isEditable,
    // One empty line is the only empty state. A second line, even blank, is text the placeholder must leave.
    isEmpty: () => editor.isEmpty,
    setMarkdown(markdown: string) {
      const view = editor.view
      const doc = editor.schema.nodeFromJSON(markdownToDoc(markdown, { isMention: options.isMention }))
      const state = EditorState.create({ doc, plugins: view.state.plugins, selection: Selection.atEnd(doc) })
      view.updateState(state)
      previousKind = null
    },
    insertText(text: string) {
      const { view } = editor
      view.dispatch(view.state.tr.replaceSelection(sliceOf(view.state, text)).scrollIntoView())
      editor.commands.focus(undefined, { scrollIntoView: false })
    },
    insertMention(slug: string) {
      const { view } = editor
      const { state } = view
      const { $from } = state.selection
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼")
      const at = before.lastIndexOf("@")
      const from = $from.start() + (at < 0 ? $from.parentOffset : at)
      const mention = state.schema.nodes.mention!.create({ slug })
      view.dispatch(state.tr.replaceWith(from, state.selection.from, [mention, state.schema.text(" ")]).scrollIntoView())
      editor.commands.focus(undefined, { scrollIntoView: false })
    },
    addChip(attrs: { id: string; name: string }) {
      const { view } = editor
      const { state } = view
      const chip = state.schema.nodes.fileChip!.create(attrs)
      const end = Selection.atEnd(state.doc).from
      const tr = state.tr.insert(end, chip).setMeta("addToHistory", false)
      view.dispatch(tr)
    },
    chips: chipIds,
    keepChips(keep: Set<string>) {
      const { state } = editor
      const gone: number[] = []
      state.doc.descendants((node, pos) => {
        if (node.type.name === "fileChip" && !keep.has(String(node.attrs.id))) gone.push(pos)
      })
      if (!gone.length) return
      const tr = state.tr.setMeta("addToHistory", false)
      for (const pos of gone.reverse()) tr.delete(pos, pos + 1)
      editor.view.dispatch(tr)
    },
    chipStatus: (id: string, status: ChipStatus) => setChipStatus(editor.view.dom as HTMLElement, id, status),
    setLink(href: string | null) {
      const { view } = editor
      const { state } = view
      const type = state.schema.marks.link!
      const range = linkRange() ?? (state.selection.empty ? null : { from: state.selection.from, to: state.selection.to })
      let tr = state.tr
      if (!href) {
        if (range) tr = tr.removeMark(range.from, range.to, type)
      } else if (range) {
        tr = tr.removeMark(range.from, range.to, type).addMark(range.from, range.to, type.create({ href }))
      } else {
        tr = tr.replaceSelectionWith(state.schema.text(href, [type.create({ href })]), false)
      }
      view.dispatch(tr)
      editor.commands.focus(undefined, { scrollIntoView: false })
    },
    selectionText: () => {
      const { doc, selection } = editor.state
      return doc.textBetween(selection.from, selection.to)
    },
    inListOrCode: () => {
      const { $from } = editor.state.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        const name = $from.node(depth).type.name
        if (name === "listItem" || name === "taskItem" || name === "codeBlock") return true
      }
      return false
    },
    destroy: () => editor.destroy(),
  }
}
