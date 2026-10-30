import { attachmentIds } from "@kiko/protocol"
import type { PromptInputV2Attachment, PromptInputV2Prompt } from "./types"

function inlineIds(prompt: PromptInputV2Prompt): Set<string> {
  return new Set(prompt.flatMap((part) => (part.type === "text" ? attachmentIds(part.content) : [])))
}

export function trayAttachments(prompt: PromptInputV2Prompt): PromptInputV2Attachment[] {
  const inline = inlineIds(prompt)
  return prompt.filter((part): part is PromptInputV2Attachment => part.type === "image" && inline.has(part.id))
}
