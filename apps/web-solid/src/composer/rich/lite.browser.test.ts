import "../composer.css"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import type { PromptInputV2Interaction } from "../prompt-input/interaction"
import { mountLite } from "./lite"

function reference(dom: HTMLElement) {
  const value = dom.innerText.replace(/\n$/, "")
  const selection = window.getSelection()
  if (!selection?.rangeCount || !dom.contains(selection.anchorNode)) return { value, cursor: value.length }
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(dom)
  range.setEnd(selection.anchorNode!, selection.anchorOffset)
  return { value, cursor: range.toString().length }
}

function mount() {
  const host = document.createElement("div")
  host.className = "composer-dock"
  document.body.append(host)
  const edits: { value: string; cursor: number }[] = []
  const controller = {
    parts: () => [],
    attachments: () => [],
    onInput: (value: string, _prompt: unknown, cursor: number) => void edits.push({ value, cursor }),
    onPaste: () => {},
    onKeyDown: () => false,
    submit: () => {},
    setEditor: () => {},
  } as unknown as PromptInputV2Interaction
  const field = mountLite({ host, controller, label: "Message", disabled: () => false, onEdit: () => {} })
  const matches = () => expect(edits.at(-1)).toEqual(reference(field.dom))
  return {
    field,
    edits,
    matches,
    [Symbol.dispose]() {
      field.destroy()
      host.remove()
    },
  }
}

describe("the plain field before the rich editor loads", () => {
  it("reports the typed text and caret the DOM holds", async () => {
    using mounted = mount()
    const { field, edits, matches } = mounted
    field.dom.focus()
    await userEvent.keyboard("ab")
    expect(edits.at(-1)).toEqual({ value: "ab", cursor: 2 })
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}")
    expect(edits.at(-1)).toEqual({ value: "ab\n", cursor: 3 })
    await userEvent.keyboard("cd")
    expect(edits.at(-1)).toEqual({ value: "ab\ncd", cursor: 5 })
    matches()
  })

  it("matches the DOM after deleting, undoing and replacing a selection", async () => {
    using mounted = mount()
    const { field, matches } = mounted
    field.dom.focus()
    await userEvent.keyboard("hello")
    await userEvent.keyboard("{Backspace}")
    matches()
    document.execCommand("undo")
    matches()
    const range = document.createRange()
    range.setStart(field.dom.firstChild!, 1)
    range.setEnd(field.dom.firstChild!, 4)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    await userEvent.keyboard("i")
    matches()
  })

  it("keeps the newlines of text the browser inserts as blocks", async () => {
    using mounted = mount()
    const { field, edits, matches } = mounted
    field.dom.focus()
    document.execCommand("insertText", false, "one\ntwo")
    expect(field.dom.querySelector("div")).not.toBeNull()
    expect(edits.at(-1)?.value).toBe("one\ntwo")
    matches()
  })

  it("matches the DOM after clearing everything", async () => {
    using mounted = mount()
    const { field, edits, matches } = mounted
    field.dom.focus()
    await userEvent.keyboard("ab")
    const range = document.createRange()
    range.selectNodeContents(field.dom)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    await userEvent.keyboard("{Backspace}")
    expect(edits.at(-1)).toEqual({ value: "", cursor: 0 })
    matches()
  })
})
