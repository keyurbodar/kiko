import { createSignal } from "solid-js"

// The model picked per chat, and the default for new chats. ASSUMPTION: the
// server has no per-chat model field yet, so the choice lives in this browser's
// localStorage as a `provider/model` string. It holds no secret.
const KEY = "yuki.chat-models"
const DEFAULT = "*"

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}")
  } catch {
    return {}
  }
}

const [picked, setPicked] = createSignal<Record<string, string>>(read())

/** The model for a chat, falling back to the default, or undefined when none is picked. */
export function chatModel(chatId: string | null): string | undefined {
  const all = picked()
  return (chatId ? all[chatId] : undefined) ?? all[DEFAULT]
}

// The store listens, so a chat's pick reaches its agents on the server (the `model` room frame).
let listener: ((chatId: string, ref: string) => void) | null = null
export const onChatModelChange = (fn: (chatId: string, ref: string) => void) => {
  listener = fn
}

/**
 * Picks a chat's model. A pick in a chat is also where the next new chat starts, as in opencode,
 * so there is no default to set anywhere else.
 */
export function setChatModel(chatId: string | null, ref: string): void {
  if (chatId) listener?.(chatId, ref)
  const next = { ...picked(), ...(chatId ? { [chatId]: ref } : {}), [DEFAULT]: ref }
  setPicked(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
}
