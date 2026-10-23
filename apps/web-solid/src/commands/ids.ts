export const CHAT_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

const COMMAND_IDS = [
  "account.sign-out",
  "browser.open",
  "browser.release",
  "browser.take-control",
  "browser.watch",
  "chat.attach",
  "chat.change-avatar",
  "chat.close",
  "chat.copy-link",
  "chat.delete",
  "chat.files",
  "chat.info",
  "chat.memory",
  "chat.model",
  "chat.new",
  "chat.new-agent",
  "chat.new-group",
  "chat.new-with",
  "chat.pin",
  "chat.reasoning",
  "chat.rename",
  "chat.reopen",
  "chat.routines",
  "chats.go",
  ...CHAT_SLOTS.map((slot) => `chats.go-${slot}` as const),
  "chats.next",
  "chats.previous",
  "chats.search-all",
  "chats.search-current",
  "files.go",
  "go.chat",
  "palette.open",
  "settings.models",
  "settings.open",
  "settings.pages",
  "theme.change",
  "view.toggle-panel",
  "view.toggle-sidebar",
] as const

export type CommandId = (typeof COMMAND_IDS)[number]

const KNOWN: ReadonlySet<string> = new Set(COMMAND_IDS)

export const isCommandId = (id: string | undefined): id is CommandId => id !== undefined && KNOWN.has(id)
