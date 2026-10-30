import { attachmentIds } from "@kiko/protocol"
import type { PromptInputV2Attachment, PromptInputV2Prompt } from "./types"

export type AttachSource = "picker" | "paste" | "drop"

export function attachPlacement(source: AttachSource, draft: string): "inline" | "tray" {
  return source !== "picker" && draft.trim() !== "" ? "inline" : "tray"
}

function inlineIds(prompt: PromptInputV2Prompt): Set<string> {
  return new Set(prompt.flatMap((part) => (part.type === "text" ? attachmentIds(part.content) : [])))
}

export function trayAttachments(prompt: PromptInputV2Prompt): PromptInputV2Attachment[] {
  const inline = inlineIds(prompt)
  return prompt.filter((part): part is PromptInputV2Attachment => part.type === "image" && !inline.has(part.id))
}

export function droppedChips(before: string, after: string): string[] {
  const kept = new Set(attachmentIds(after))
  return [...new Set(attachmentIds(before))].filter((id) => !kept.has(id))
}
