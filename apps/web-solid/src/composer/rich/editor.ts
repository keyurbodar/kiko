import "./rich.css"
import {
  Editor,
  Extension,
  InputRule,
  markInputRule,
  mergeAttributes,
  wrappingInputRule,
  type ExtendedRegExpMatchArray,
} from "@tiptap/core"
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
import { Fragment, Slice, type MarkType, type Node as PMNode, type NodeType } from "@tiptap/pm/model"
import { EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Command } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { isMac } from "../../lib/platform"
import { caretTakesMarksBefore, stepCaretAcrossStyledEdge } from "./styled-edge"
import {
  backspaceAcrossList,
  bulletItemToTask,
  deleteAcrossList,
  exitCodeBlockOnClosingFence,
  exitCodeBlockOnTrailingBlankLines,
  indentInCode,
  indentedNewlineInCodeBlock,
  leaveEmptyQuote,
  openFenceOnEnter,
  selectionInOneCodeBlock,
  splitOrLeaveListItem,
  unwrapCodeBlockAtStart,
} from "./keys"
import { hasFileDrag } from "../../lib/file-drag"
import { copyComposerFragment } from "./clipboard"
import { BINDINGS } from "./keymap"
import { docToMarkdown, markdownToDoc, type Json, type ParseOptions } from "./markdown"
import {
  attachmentExtension,
  CHIP_NODES,
  type ChipView,
  fileRefExtension,
  type FileRefView,
  Link,
  mentionExtension,
  popNextToken,
  slashExtension,
  type TokenView,
} from "./nodes"
import { chipFragment, type Point } from "./insert"
import { isLoneLink, markdownSlice } from "./paste"
import { groupUndoByChangeKind, UNDO_GROUP_DELAY, type ChangeKind } from "./undo-grouping"

export type Snapshot = { markdown: string; plain: string; cursor: number }

export type RichOptions = {
  element: HTMLElement
  markdown: string
  label: string
  parse: ParseOptions
  token: TokenView
  chip: ChipView
  fileRef: FileRefView
  onChange: (snapshot: Snapshot) => void
  onCursor: (cursor: number, plain: string) => void
  onKeyDown: (event: KeyboardEvent) => boolean
  pastedText?: (clipboard: DataTransfer) => string
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
      props.state.doc.resolve(props.range.from).depth === 1 ? rule.handler(props) : null,
  })
}

const ATOM = "\uFFFC"

const selectChipBefore: Command = (state, dispatch) => {
  const { selection } = state
  if (!selection.empty) return false
  const before = selection.$from.nodeBefore
  if (!before || !CHIP_NODES.has(before.type.name)) return false
  dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, selection.from - before.nodeSize)))
  return true
}

const MARKER: Record<string, string> = { bold: "**", italic: "_", strike: "~~", code: "`" }

const PLAIN_PASTE_CHARS = 20_000

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
      for (const name of Array.from(open.keys())) if (!names.has(name)) close(name, pos)
      for (const name of names) if (!open.has(name)) open.set(name, pos)
      pos += child.nodeSize
    })
    for (const name of Array.from(open.keys())) close(name, pos)
    return false
  })
  return ranges
}

function decorationsForSelection(state: EditorState): DecorationSet {
  const { from, to, empty } = state.selection
  const caretSide = caretTakesMarksBefore(state) ? 3 : 0
  const widgets: Decoration[] = []
  for (const range of styledRanges(state.doc)) {
    const on = empty ? from >= range.from && from <= range.to : from < range.to && to > range.from
    if (!on) continue
    for (const [at, baseSide] of [
      [range.from, -1],
      [range.to, 1],
    ] as const) {
      const side = empty && at === from ? baseSide + caretSide : baseSide
      const mark = document.createElement("span")
      mark.className = "composer-rich-marker"
      mark.textContent = range.text
      mark.setAttribute("aria-hidden", "true")
      widgets.push(Decoration.widget(at, mark, { side, key: `marker-${at}-${side}-${range.text}` }))
    }
  }
  return DecorationSet.create(state.doc, widgets)
}

const markerKey = new PluginKey<DecorationSet>("composerRichMarkers")

const markers = new Plugin({
  key: markerKey,
  state: {
    init: (_, state) => decorationsForSelection(state),
    apply: (transaction, previous, _old, state) =>
      transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet
        ? decorationsForSelection(state)
        : previous,
  },
  props: {
    decorations: (state) => markerKey.getState(state) ?? null,
  },
})

function codeInputRule(type: MarkType): InputRule {
  const rule = markInputRule({ find: /(^|[^`])`([^`]*[^`\s][^`]*)`(?!`)$/, type })
  return new InputRule({
    find: rule.find,
    undoable: false,
    handler: (props) => {
      const result = rule.handler(props)
      const { tr } = props.state
      const { $from } = tr.selection
      if (result !== null && tr.selection.empty && $from.nodeBefore?.marks.some((mark) => mark.type === type))
        tr.setStoredMarks($from.nodeAfter?.marks ?? [])
      return result
    },
  })
}

const leaveHeading: Command = (state, dispatch) =>
  state.selection.$from.parent.type.name === "heading" && splitBlock(state, dispatch)

const unsetHeadingAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== "heading") return false
  return setBlockType(state.schema.nodes.paragraph!)(state, dispatch)
}

const newline: Command = (state, dispatch) =>
  splitOrLeaveListItem(state, dispatch) ||
  leaveEmptyQuote(state, dispatch) ||
  leaveHeading(state, dispatch) ||
  splitBlockKeepMarks(state, dispatch)

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])

function moveAlongLine(view: EditorView, event: KeyboardEvent): boolean {
  const boundary = event.metaKey
    ? event.key === "ArrowLeft" || event.key === "ArrowRight"
      ? "lineboundary"
      : event.key === "ArrowUp" || event.key === "ArrowDown"
        ? "documentboundary"
        : null
    : event.key === "Home" || event.key === "End"
      ? "lineboundary"
      : null
  if (!isMac || !boundary || event.altKey || event.ctrlKey || event.isComposing) return false
  const selection = window.getSelection()
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !view.dom.contains(selection.anchorNode) ||
    typeof selection.modify !== "function"
  )
    return false
  event.preventDefault()
  const backward = event.key === "Home" || event.key === "ArrowUp" || event.key === "ArrowLeft"
  selection.modify(event.shiftKey ? "extend" : "move", backward ? "backward" : "forward", boundary)
  if (!selection.anchorNode || !selection.focusNode) return true
  const tr = view.state.tr.setSelection(
    TextSelection.create(
      view.state.doc,
      view.posAtDOM(selection.anchorNode, selection.anchorOffset),
      view.posAtDOM(selection.focusNode, selection.focusOffset),
    ),
  )
  if (tr.selection.empty) {
    const { $head } = tr.selection
    tr.setStoredMarks((backward ? $head.nodeBefore : $head.nodeAfter)?.marks ?? [])
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

function stepAcrossStyledEdges(view: EditorView, event: KeyboardEvent): boolean {
  if (
    !ARROWS.has(event.key) ||
    event.shiftKey ||
    event.altKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.isComposing ||
    !view.state.selection.empty
  )
    return false
  const { $from } = view.state.selection
  const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1
  const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight"
  const atDocumentEdge =
    $from.pos ===
    (direction === -1 ? TextSelection.atStart(view.state.doc).from : TextSelection.atEnd(view.state.doc).to)
  const step = horizontal || atDocumentEdge ? stepCaretAcrossStyledEdge(view.state, direction) : null
  if (step) {
    event.preventDefault()
    view.dispatch(step)
    return true
  }
  const adjacent = direction === -1 ? $from.nodeBefore : $from.nodeAfter
  if (horizontal && adjacent && CHIP_NODES.has(adjacent.type.name)) {
    event.preventDefault()
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, $from.pos + direction * adjacent.nodeSize))
        .scrollIntoView(),
    )
    return true
  }
  return false
}

export function mountRichEditor(options: RichOptions) {
  let previousKind: ChangeKind | null = null
  let lastMarkdown = ""

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
          Backspace: chainCommands(selectChipBefore, backspaceAcrossList, unwrapCodeBlockAtStart, unsetHeadingAtStart),
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
    content: markdownToDoc(options.markdown, options.parse),
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
        addInputRules() {
          return [codeInputRule(this.type)]
        },
      }),
      Blockquote.extend({
        addInputRules() {
          return [blockquoteInputRule]
        },
      }),
      Heading.extend({
        addInputRules() {
          return [headingInputRule]
        },
      }),
      HorizontalRule.extend({
        addInputRules() {
          return [horizontalRuleInputRule]
        },
      }),
      CodeBlock.extend({
        addInputRules() {
          return []
        },
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
      mentionExtension(options.token),
      slashExtension(options.token),
      attachmentExtension(options.chip),
      fileRefExtension(options.fileRef),
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
      handleDOMEvents: {
        copy: (view, event) => copySelection(view, event, false),
        cut: (view, event) => copySelection(view, event, true),
      },
      handleKeyDown: (view, event) => {
        if (moveAlongLine(view, event) || stepAcrossStyledEdges(view, event)) return true
        if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
          if (indentInCode(view.state, event.shiftKey, view.dispatch)) {
            event.preventDefault()
            return true
          }
        }
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.isComposing) {
          if (selectionInOneCodeBlock(view.state)) {
            event.preventDefault()
            void (
              exitCodeBlockOnClosingFence(view.state, view.dispatch) ||
              exitCodeBlockOnTrailingBlankLines(view) ||
              indentedNewlineInCodeBlock(view.state, view.dispatch) ||
              newlineInCode(view.state, view.dispatch)
            )
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
        const text =
          event.clipboardData &&
          (options.pastedText?.(event.clipboardData) ?? event.clipboardData.getData("text/plain"))
        if (!text) return true
        event.preventDefault()
        const { state } = view
        const code = state.selection.$from.parent.type.spec.code
        const plain = !code && text.length > PLAIN_PASTE_CHARS
        const slice = code || plain ? sliceOf(state, text) : markdownSlice(state.schema, text, options.parse)
        const tr = state.tr.replaceSelection(slice)
        if (!code && state.doc.textContent === "" && isLoneLink(event.clipboardData?.getData("text/plain") ?? ""))
          tr.split(tr.selection.from).setStoredMarks([])
        view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"))
        return true
      },
      clipboardTextSerializer: (slice, view) =>
        view.state.selection.$from.parent.type.spec.code
          ? slice.content.textBetween(0, slice.content.size, "\n")
          : docToMarkdown({ type: "doc", content: slice.content.toJSON() ?? [] }),
      handleDrop: (_view, event) =>
        !!event.dataTransfer && (event.dataTransfer.types.includes("Files") || hasFileDrag(event.dataTransfer)),
    },
    onUpdate: () => {
      lastMarkdown = docToMarkdown(editor.state.doc.toJSON() as Json)
      const { plain, cursor } = cursorInfo()
      options.onChange({ markdown: lastMarkdown, plain, cursor })
    },
    onSelectionUpdate: () => {
      const { plain, cursor } = cursorInfo()
      options.onCursor(cursor, plain)
    },
    onFocus: options.onFocus,
    onBlur: options.onBlur,
  })

  lastMarkdown = docToMarkdown(editor.state.doc.toJSON() as Json)

  function copySelection(view: EditorView, event: ClipboardEvent, cut: boolean) {
    if (!event.clipboardData || view.state.selection.empty) return false
    const text = docToMarkdown({ type: "doc", content: view.state.selection.content().content.toJSON() ?? [] })
    event.preventDefault()
    event.clipboardData.setData("text/plain", text)
    copyComposerFragment(text, event.clipboardData)
    if (cut) view.dispatch(view.state.tr.deleteSelection().setMeta("uiEvent", "cut"))
    return true
  }

  function cursorInfo(): { plain: string; cursor: number } {
    const { doc, selection } = editor.state
    const plain = (end: number) =>
      doc.textBetween(0, end, "\n", (leaf) => (leaf.type.name === "hardBreak" ? "\n" : ATOM))
    return { plain: plain(doc.content.size), cursor: plain(selection.from).length }
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

  function insertChips(chips: readonly { type: string; attrs: Record<string, unknown> }[], at?: Point) {
    const { view } = editor
    const hit = at ? view.posAtCoords({ left: at.x, top: at.y }) : null
    const base = hit ? view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))) : view.state.tr
    const { $from } = base.selection
    const before = $from.nodeBefore
    const fragment = chipFragment(
      view.state.schema,
      chips,
      before ? (before.isText ? before.text?.at(-1) : "x") : undefined,
    )
    view.dispatch(base.replaceSelection(new Slice(fragment, 0, 0)).scrollIntoView())
  }

  return {
    dom: editor.view.dom as HTMLElement,
    markdown: () => lastMarkdown,
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
      const doc = editor.schema.nodeFromJSON(markdownToDoc(markdown, options.parse))
      const state = EditorState.create({ doc, plugins: view.state.plugins, selection: Selection.atEnd(doc) })
      view.updateState(state)
      lastMarkdown = docToMarkdown(doc.toJSON() as Json)
      previousKind = null
    },
    insertText(text: string) {
      const { view } = editor
      view.dispatch(view.state.tr.replaceSelection(sliceOf(view.state, text)).scrollIntoView())
      editor.commands.focus(undefined, { scrollIntoView: false })
    },
    insertToken(trigger: "@" | "/", node: { type: string; attrs: Record<string, unknown> }) {
      const { view } = editor
      const { state } = view
      const { $from } = state.selection
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, ATOM)
      const typed = new RegExp(`(?:^|\\s)\\${trigger}[^\\s@/${ATOM}]*$`).exec(before)
      const at = typed ? before.length - typed[0].trimStart().length : $from.parentOffset
      const from = $from.start() + at
      const lead = typed || at === 0 || /\s$/.test(before) ? [] : [state.schema.text(" ")]
      popNextToken()
      view.dispatch(
        state.tr
          .replaceWith(from, state.selection.to, [
            ...lead,
            state.schema.nodes[node.type]!.create(node.attrs),
            state.schema.text(" "),
          ])
          .scrollIntoView(),
      )
      editor.commands.focus(undefined, { scrollIntoView: false })
    },
    insertAttachments(items: readonly { id: string; name: string }[], at?: Point) {
      popNextToken()
      insertChips(
        items.map((item) => ({ type: "attachment", attrs: { id: item.id, name: item.name } })),
        at,
      )
    },
    insertFileRefs(paths: readonly string[], at?: Point) {
      insertChips(
        paths.map((path) => ({
          type: "fileRef",
          attrs: { path: path.replace(/\/+$/, ""), ...(path.endsWith("/") ? { folder: true } : {}) },
        })),
        at,
      )
    },
    removeAttachment(id: string) {
      const { view } = editor
      const tr = view.state.tr
      view.state.doc.descendants((node, pos) => {
        if (node.type.name !== "attachment" || node.attrs.id !== id) return
        const end = pos + node.nodeSize
        const spaced = view.state.doc.textBetween(end, Math.min(end + 1, view.state.doc.content.size)) === " "
        tr.delete(tr.mapping.map(pos), tr.mapping.map(spaced ? end + 1 : end))
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
