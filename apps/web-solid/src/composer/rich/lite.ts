import { createEffect, createRoot } from "solid-js"
import type { PromptInputV2Interaction } from "../prompt-input/interaction"
import { composingKey, enterIsNewline } from "../ime"

export type LiteField = {
  dom: HTMLElement
  isEmpty: () => boolean
  focus: () => void
  isFocused: () => boolean
  destroy: () => void
}

export function mountLite(input: {
  host: HTMLElement
  controller: PromptInputV2Interaction
  label: string
  disabled: () => boolean
  onEdit: () => void
}): LiteField {
  const { controller } = input
  const markdown = () =>
    controller
      .parts()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
  const dom = document.createElement("div")
  dom.className = "composer-input focus:outline-none"
  dom.setAttribute("data-component", "prompt-input")
  dom.setAttribute("role", "textbox")
  dom.setAttribute("aria-multiline", "true")
  dom.setAttribute("aria-label", input.label)
  dom.textContent = markdown()
  input.host.appendChild(dom)

  const textOnly = () => {
    for (const node of dom.childNodes) if (node.nodeType !== Node.TEXT_NODE) return false
    return true
  }
  const text = () => (textOnly() ? (dom.textContent ?? "") : dom.innerText).replace(/\n$/, "")
  const cursor = () => {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !dom.contains(selection.anchorNode)) return text().length
    const edge = document.createRange()
    edge.setStart(selection.anchorNode!, selection.anchorOffset)
    edge.collapse(true)
    const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT)
    let total = 0
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (node === selection.anchorNode) return total + selection.anchorOffset
      if (edge.comparePoint(node, 0) !== -1) return total
      total += node.data.length
    }
    return total
  }
  const sync = () => {
    const value = text()
    controller.onInput(
      value,
      [{ type: "text", content: value, start: 0, end: value.length }, ...controller.attachments()],
      cursor(),
    )
    input.onEdit()
  }

  dom.addEventListener("input", sync)
  dom.addEventListener("paste", (event) => {
    const items = Array.from(event.clipboardData?.items ?? [])
    if (items.some((item) => item.kind === "file") || !event.clipboardData?.getData("text/plain")) {
      event.preventDefault()
      controller.onPaste(event)
    }
  })
  dom.addEventListener("keydown", (event) => {
    if (controller.onKeyDown(event)) return
    if (event.key !== "Enter" || composingKey(event) || event.shiftKey || event.altKey || enterIsNewline(event)) return
    event.preventDefault()
    if (!event.repeat) controller.submit()
  })

  const disposeEffects = createRoot((dispose) => {
    createEffect(() => {
      const editable = !input.disabled()
      dom.contentEditable = editable ? "plaintext-only" : "false"
      if (editable && dom.contentEditable !== "plaintext-only") dom.contentEditable = "true"
    })
    createEffect(() => {
      const value = markdown()
      if (value === text()) return
      dom.textContent = value
      input.onEdit()
    })
    return dispose
  })

  controller.setEditor(dom)
  const destroy = () => {
    disposeEffects()
    dom.remove()
  }
  return {
    dom,
    isEmpty: () => text().trim() === "",
    focus: () => {
      dom.focus()
      const range = document.createRange()
      range.selectNodeContents(dom)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    },
    isFocused: () => document.activeElement === dom,
    destroy,
  }
}
