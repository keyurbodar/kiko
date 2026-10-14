import { Mark, mergeAttributes, Node } from "@tiptap/core"
import { createElement, X } from "lucide"
import "../../lib/chip.css"
import { entryIconMarkup, loadEntryIcons } from "../../lib/entry-icon"
import { identityLook, identityTint } from "../../lib/identity"

export const Link = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes: () => ({ href: { default: null } }),
  parseHTML: () => [{ tag: "a[href]" }],
  renderHTML: ({ HTMLAttributes }) => ["a", mergeAttributes(HTMLAttributes, { rel: "noopener noreferrer nofollow" }), 0],
})

export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes: () => ({ slug: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-mention]" }],
  renderHTML: ({ node }) => [
    "span",
    { "data-mention": String(node.attrs.slug), style: `color:${identityLook(String(node.attrs.slug)).color};background:${identityTint(String(node.attrs.slug), 16)}` },
    `@${node.attrs.slug}`,
  ],
  renderText: ({ node }) => `@${node.attrs.slug}`,
})

export type ChipStatus = { state: "uploading" | "failed" | "ready"; label?: string; reason?: string }

export function middleTruncate(name: string, max = 36): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf(".")
  const extension = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ""
  const room = max - extension.length - 1
  const head = Math.ceil(room * 0.6)
  const tail = room - head
  const stem = name.slice(0, name.length - extension.length)
  return `${stem.slice(0, head)}…${tail > 0 ? stem.slice(-tail) : ""}${extension}`
}

export function chipExtension(onAction: (id: string) => void, onRemove: (id: string) => void) {
  return Node.create({
    name: "fileChip",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes: () => ({ id: { default: "" }, name: { default: "" } }),
    parseHTML: () => [{ tag: "span[data-chip-id]" }],
    renderHTML: ({ node }) => ["span", { "data-chip-id": String(node.attrs.id) }, String(node.attrs.name)],
    renderText: () => "",
    addNodeView: () => ({ node }) => {
      const dom = document.createElement("span")
      dom.className = "file-chip composer-chip"
      dom.contentEditable = "false"
      dom.dataset.chipId = String(node.attrs.id)
      // The file's own icon, as t3code's file chips draw it. The wrapper is boxless so the chip sizes the svg.
      const icon = document.createElement("span")
      icon.style.display = "contents"
      const iconName = String(node.attrs.name)
      icon.innerHTML = entryIconMarkup(iconName)
      void loadEntryIcons().then(() => {
        icon.innerHTML = entryIconMarkup(iconName)
      })
      const name = document.createElement("span")
      name.className = "file-chip-label"
      name.textContent = middleTruncate(String(node.attrs.name))
      name.title = String(node.attrs.name)
      // A real button, so a failed upload's Retry is reachable by Tab and Enter. It is disabled until the upload fails.
      const status = document.createElement("button")
      status.type = "button"
      status.className = "composer-chip-status"
      status.dataset.action = "retry-upload"
      status.disabled = true
      status.setAttribute("aria-label", `Retry upload for ${node.attrs.name}`)
      // Removal is a button, not a Backspace guess: it shows on hover, and a touch screen has no hover.
      const remove = document.createElement("button")
      remove.type = "button"
      remove.className = "composer-chip-remove"
      remove.setAttribute("aria-label", `Remove ${node.attrs.name}`)
      const removeIcon = createElement(X)
      removeIcon.setAttribute("aria-hidden", "true")
      remove.append(removeIcon)
      remove.addEventListener("click", (event) => {
        event.stopPropagation()
        onRemove(String(node.attrs.id))
      })
      dom.append(icon, name, status, remove)
      // A click on the chip, or Enter on its focused Retry button (which clicks), retries a failed upload.
      dom.addEventListener("click", () => {
        if (dom.dataset.state === "failed") onAction(String(node.attrs.id))
      })
      return {
        dom,
        ignoreMutation: () => true,
        // Keys and clicks on the Retry or Remove button belong to the button, not to the editor.
        stopEvent: (event) => event.target instanceof Element && event.target.closest("button") !== null,
      }
    },
  })
}

export function setChipStatus(root: HTMLElement, id: string, status: ChipStatus) {
  const chip = root.querySelector<HTMLElement>(`[data-chip-id="${CSS.escape(id)}"]`)
  if (!chip) return
  chip.dataset.state = status.state
  const label = chip.querySelector<HTMLButtonElement>(".composer-chip-status")
  if (label) {
    label.textContent = status.state === "failed" ? "Retry" : (status.label ?? "")
    label.disabled = status.state !== "failed"
  }
  chip.title = status.state === "failed" ? (status.reason ?? "Upload failed") : ""
}
