import type { ChatMessage, MessageFile } from "../lib/types"

export function withSentFiles(view: ChatMessage, sent: readonly MessageFile[]): ChatMessage {
  if (!view.files) return { ...view, files: [...sent] }
  if (view.files.length !== sent.length) return view
  return { ...view, files: view.files.map((file, i) => ({ ...file, src: sent[i]!.src })) }
}
