import "./rich.css"
import { Editor, Extension, InputRule, markInputRule, mergeAttributes, wrappingInputRule, type ExtendedRegExpMatchArray } from "@tiptap/core"
import { Blockquote } from "@tiptap/extension-blockquote"
import { Code } from "@tiptap/extension-code"
import { CodeBlock } from "@tiptap/extension-code-block"
import { Heading } from "@tiptap/extension-heading"
import { HorizontalRule } from "@tiptap/extension-horizontal-rule"
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list"
import { TaskItem } from "@tiptap/extension-task-item"
import { TaskList } from "@tiptap/extension-task-list"
import { Bold } from "@tiptap/extension-bold"
import { Document } from "@tiptap/extension-document"
import { HardBreak } from "@tiptap/extension-hard-break"
import { Italic } from "@tiptap/extension-italic"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Strike } from "@tiptap/extension-strike"
import { Text } from "@tiptap/extension-text"
import { UndoRedo } from "@tiptap/extensions"
import { chainCommands, newlineInCode, setBlockType, splitBlock, splitBlockKeepMarks } from "@tiptap/pm/commands"
import { keymap } from "@tiptap/pm/keymap"
import { Fragment, Slice, type Node as PMNode, type NodeType } from "@tiptap/pm/model"
import { EditorState, Plugin, Selection, TextSelection, type Command, type Transaction } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { backspaceAcrossList, bulletItemToTask, deleteAcrossList, exitCodeBlockOnClosingFence, exitCodeBlockOnTrailingBlankLines, indentInCode, indentedNewlineInCodeBlock, leaveEmptyQuote, openFenceOnEnter, selectionInOneCodeBlock, splitOrLeaveListItem, unwrapCodeBlockAtStart } from "./keys"
import { BINDINGS } from "./keymap"
import { docToMarkdown, markdownToDoc, type Json } from "./markdown"
import { attachmentExtension, type ChipView, Link, Mention } from "./nodes"
import { markdownSlice } from "./paste"
import { groupUndoByChangeKind, UNDO_GROUP_DELAY, type ChangeKind } from "./undo-grouping"

export type Snapshot = { markdown: string; plain: string; cursor: number }

export type RichOptions = {
  element: HTMLElement
  markdown: string
  label: string
  isMention: (slug: string) => boolean
  chip: ChipView
  onChange: (snapshot: Snapshot) => void
  onCursor: (cursor: number) => void
  onKeyDown: (event: KeyboardEvent) => boolean
  onPaste: (event: ClipboardEvent) => boolean
  onFocus: () => void
  onBlur: () => void
}

export type RichEditor = ReturnType<typeof mountRichEditor>

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
      const carried = (match.groups?.carried ?? "") as string
      const $from = state.doc.resolve(range.from)
      if ($from.parent.type.name !== "paragraph" || $from.depth !== 1) return null
      const command = chain()
        .deleteRange(range)
        .wrapInList(listType, listType === "orderedList" ? { start: Number.parseInt(marker, 10) || 1 } : {})
        .updateAttributes("listItem", { marker })
      if (carried) command.insertContent(carried)
      command.run()
      return undefined
    },
  })
}

const bulletToTaskInputRule = new InputRule({
  find: /^\[([ xX])\] $/,
  handler: ({ state, range, match, chain }) => {
    const $from = state.doc.resolve(range.from)
    const item = $from.node(-1)
    if ($from.parent.type.name !== "paragraph" || item?.type.name !== "listItem") return null
    if (!["-", "*", "+"].includes(String(item.attrs.marker))) return null
    const checked = (match[1] ?? " ").toLowerCase() === "x"
    chain()
      .command(({ tr }) => {
        bulletItemToTask(tr, range.from, range.to, checked)
        return true
      })
      .run()
    return undefined
  },
})

function taskInputRule(type: NodeType): InputRule {
  const rule = wrappingInputRule({
    find: /^- \[([ xX])\] $/,
    type,
    getAttributes: (match: ExtendedRegExpMatchArray) => ({ checked: (match[1] ?? " ").toLowerCase() === "x" }),
  })
  return new InputRule({
    find: rule.find,
    handler: (props: Parameters<InputRule["handler"]>[0]) =>
      (props.state.doc.resolve(props.range.from).depth === 1 ? rule.handler(props) : null),
  })
}

const MARKER: Record<string, string> = { bold: "**", italic: "_", strike: "~~", code: "`" }

/** Each run of one mark inside a text block, as document positions. */
function styledRanges(doc: PMNode): { from: number; to: number; text: string }[] {
  const ranges: { from: number; to: number; text: string }[] = []
  doc.descendants((block, start) => {
    if (!block.isTextblock || block.type.spec.code) return true
    const open = new Map<string, number>()
    let pos = start + 1
    const close = (name: string, at: number) => {
      ranges.push({ from: open.get(name)!, to: at, text: MARKER[name]! })
      open.delete(name)
    }
    block.forEach((child) => {
      const names = new Set(child.marks.map((m) => m.type.name).filter((n) => n in MARKER))
      for (const name of [...open.keys()]) if (!names.has(name)) close(name, pos)
      for (const name of names) if (!open.has(name)) open.set(name, pos)
      pos += child.nodeSize
    })
    for (const name of [...open.keys()]) close(name, pos)
    return false
  })
  return ranges
}

/** t3code's marker reveal: the Markdown markers of the styled text under the caret show, faintly. */
const markers = new Plugin({
  props: {
    decorations(state) {
      const { from, to, empty } = state.selection
      const widgets: Decoration[] = []
      for (const range of styledRanges(state.doc)) {
        const on = empty ? from >= range.from && from <= range.to : from < range.to && to > range.from
        if (!on) continue
        for (const [at, side] of [[range.from, -1], [range.to, 1]] as const) {
          const mark = document.createElement("span")
          mark.className = "composer-rich-marker"
          mark.textContent = range.text
          mark.setAttribute("aria-hidden", "true")
          widgets.push(Decoration.widget(at, mark, { side, key: `${at}${side}${range.text}` }))
        }
      }
      return DecorationSet.create(state.doc, widgets)
    },
  },
})

/** A new line after a heading is a paragraph, as in t3code. A line break would keep it a heading. */
const leaveHeading: Command = (state, dispatch) => state.selection.$from.parent.type.name === "heading" && splitBlock(state, dispatch)

/** Backspace at the start of a heading turns it back into a paragraph, so `# ` can be undone. */
const unsetHeadingAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== "heading") return false
  return setBlockType(state.schema.nodes.paragraph!)(state, dispatch)
}

/**
 * A newline starts a new block, as in t3code, rather than a line break: a break would keep the
 * caret inside the block it came from, so the next line could never become a heading, a rule, a
 * list or a fence. Marks carry over so bold text continues, and a list, an empty quote and a
 * heading each leave the block their own way.
 */
const newline: Command = (state, dispatch) =>
  splitOrLeaveListItem(state, dispatch) ||
  leaveEmptyQuote(state, dispatch) ||
  leaveHeading(state, dispatch) ||
  splitBlockKeepMarks(state, dispatch)

export function mountRichEditor(options: RichOptions) {
  let previousKind: ChangeKind | null = null

  const Keys = Extension.create({
    name: "composerKeys",
    priority: 1000,
    addProseMirrorPlugins() {
      const schema = this.editor.schema
      const bindings = Object.fromEntries(BINDINGS.map((binding) => [binding.key, binding.command(schema)]))
      return [
        keymap({
          ...bindings,
          "Shift-Enter": newline,
          Backspace: chainCommands(backspaceAcrossList, unwrapCodeBlockAtStart, unsetHeadingAtStart),
          Delete: deleteAcrossList,
        }),
        markers,
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
      Code.extend({
        excludes: "code",
        exitable: false,
        // Tiptap's rule, except the code must hold more than spaces, so a stray pair never wraps a blank.
        addInputRules() {
          return [markInputRule({ find: /(^|[^`])`([^`]*[^`\s][^`]*)`(?!`)$/, type: this.type })]
        },
      }),
      Blockquote.extend({
        addInputRules() { return [blockquoteInputRule] },
      }),
      Heading.extend({
        addInputRules() { return [headingInputRule] },
      }),
      HorizontalRule.extend({
        addInputRules() { return [horizontalRuleInputRule] },
      }),
      CodeBlock.extend({
        addInputRules() { return [] },
        addAttributes() {
          return {
            ...this.parent?.(),
            language: { default: "" },
            fence: { default: "```", rendered: false },
            close: { default: "\n```", rendered: false },
          }
        },
      }),
      UndoRedo.configure({ newGroupDelay: UNDO_GROUP_DELAY }),
      BulletList.extend({
        addInputRules() {
          return [
            listMarkerInputRule(/^(?<marker>[*+])(?<space>\s)$/, "bulletList"),
            listMarkerInputRule(/^(?<marker>-)(?<space>[ \t]+)(?<carried>[^\s[])$/, "bulletList"),
          ]
        },
      }),
      OrderedList.extend({
        addInputRules() {
          return [listMarkerInputRule(/^(?<marker>\d+[.)])(?<space>\s)$/, "orderedList")]
        },
      }),
      ListItem.extend({
        addAttributes() {
          return { marker: { default: "-", rendered: false } }
        },
        addInputRules() {
          return [bulletToTaskInputRule]
        },
        renderHTML({ node, HTMLAttributes }) {
          return ["li", mergeAttributes(HTMLAttributes, { "data-marker": node.attrs.marker }), 0]
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }).extend({
        addInputRules() {
          return [taskInputRule(this.type)]
        },
      }),
      Link,
      Mention,
      attachmentExtension(options.chip),
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
      handleKeyDown: (view, event) => {
        if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (indentInCode(view.state, event.shiftKey, view.dispatch)) {
            event.preventDefault()
            return true
          }
        }
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.isComposing) {
          if (selectionInOneCodeBlock(view.state)) {
            event.preventDefault()
            exitCodeBlockOnClosingFence(view.state, view.dispatch) ||
              exitCodeBlockOnTrailingBlankLines(view) ||
              indentedNewlineInCodeBlock(view.state, view.dispatch) ||
              newlineInCode(view.state, view.dispatch)
            return true
          }
          if (openFenceOnEnter(view.state, view.dispatch)) {
            event.preventDefault()
            return true
          }
        }
        return options.onKeyDown(event)
      },
      handlePaste: (view, event) => {
        if (options.onPaste(event)) return true
        const text = event.clipboardData?.getData("text/plain")
        if (!text) return true
        event.preventDefault()
        const { state } = view
        const slice = state.selection.$from.parent.type.spec.code
          ? sliceOf(state, text)
          : markdownSlice(state.schema, text, { isMention: options.isMention })
        view.dispatch(state.tr.replaceSelection(slice).scrollIntoView().setMeta("uiEvent", "paste"))
        return true
      },
      clipboardTextSerializer: (slice, view) =>
        view.state.selection.$from.parent.type.spec.code
          ? slice.content.textBetween(0, slice.content.size, "\n")
          : docToMarkdown({ type: "doc", content: slice.content.toJSON() ?? [] }),
      handleDrop: (_view, event) => !!event.dataTransfer?.types.includes("Files"),
    },
    onUpdate: () => {
      options.onChange(snapshot())
    },
    onSelectionUpdate: () => options.onCursor(snapshot().cursor),
    onFocus: options.onFocus,
    onBlur: options.onBlur,
  })

  function snapshot(): Snapshot {
    const { doc, selection } = editor.state
    const plain = (end: number) => doc.textBetween(0, end, "\n", (leaf) => (leaf.type.name === "mention" ? `@${leaf.attrs.slug}` : ""))
    return { markdown: docToMarkdown(doc.toJSON() as Json), plain: plain(doc.content.size), cursor: plain(selection.from).length }
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

  return {
    dom: editor.view.dom as HTMLElement,
    snapshot,
    focus: () => editor.commands.focus("end", { scrollIntoView: false }),
    isFocused: () => editor.isFocused,
    setEditable: (editable: boolean) => editor.setEditable(editable, false),
    isEditable: () => editor.isEditable,
    isEmpty: () => {
      const { doc } = editor.state
      return doc.childCount === 1 && doc.firstChild!.type.name === "paragraph" && doc.firstChild!.content.size === 0
    },
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
    /** Puts a chip per attachment at the caret, each followed by a space. */
    insertAttachments(items: readonly { id: string; name: string }[]) {
      const { view } = editor
      const { state } = view
      const nodes = items.flatMap((item) => [state.schema.nodes.attachment!.create(item), state.schema.text(" ")])
      view.dispatch(state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0)).scrollIntoView())
    },
    /** Takes every chip of attachment `id` out of the text. */
    removeAttachment(id: string) {
      const { view } = editor
      const tr = view.state.tr
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "attachment" && node.attrs.id === id) tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize))
      })
      if (tr.docChanged) view.dispatch(tr)
    },
    selectionText: () => {
      const { doc, selection } = editor.state
      return doc.textBetween(selection.from, selection.to)
    },
    inCode: () => editor.state.selection.$from.parent.type.name === "codeBlock",
    destroy: () => editor.destroy(),
  }
}
