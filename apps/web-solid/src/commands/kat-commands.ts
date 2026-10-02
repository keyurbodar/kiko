import type { Command } from "./registry"

/*
 * kat's command map (screenshot 20). Titles are lowercase `noun: verb`.
 * A command whose feature does not exist yet stays registered and disabled,
 * so the palette and the cheatsheet already list it. `chat: share` is left out
 * on purpose: kiko has no share links.
 */
const never = () => false
const nothing = () => {}

/** The pure part: the table of commands, given what they act on. */
export function katCommands(deps: {
  toggleSidebar: () => void
  newChat: () => void
  closeChat: () => void
  hasActiveChat: () => boolean
  toggleInfo: () => void
  openPalette: () => void
  openChats: () => void
}): Command[] {
  return [
    { id: "view.toggle-sidebar", title: "view: toggle sidebar", group: "view", icon: "menu", shortcut: "Mod+S", global: true, run: deps.toggleSidebar },
    { id: "chat.new", title: "chat: new", group: "chat", icon: "plus", shortcut: "Mod+N", alias: "Mod+T", run: deps.newChat },
    { id: "chat.reopen", title: "chat: reopen closed", group: "chat", icon: "undo", shortcut: "Mod+Shift+T", when: never, run: nothing },
    { id: "chat.attach", title: "chat: attach file...", group: "chat", icon: "attach", shortcut: "Mod+O", when: never, run: nothing },
    { id: "chat.rename", title: "chat: rename", group: "chat", icon: "edit", shortcut: "F2", when: never, run: nothing },
    { id: "chat.pin", title: "chat: pin", group: "chat", icon: "pin", shortcut: "Mod+D", when: never, run: nothing },
    { id: "chat.info", title: "chat: info", group: "chat", icon: "info", shortcut: "Mod+I", global: true, when: deps.hasActiveChat, run: deps.toggleInfo },
    { id: "chat.close", title: "chat: close", group: "chat", icon: "close", shortcut: "Mod+W", when: deps.hasActiveChat, run: deps.closeChat },
    { id: "chat.delete", title: "chat: delete", group: "chat", icon: "trash", when: never, run: nothing },
    { id: "chats.go", title: "chats: go to chat...", group: "chats", icon: "chat", shortcut: "Mod+P", global: true, run: deps.openChats },
    { id: "chats.search-current", title: "chats: search messages in current chat", group: "chats", icon: "search", shortcut: "Mod+F", when: never, run: nothing },
    { id: "chats.search-all", title: "chats: search all chats", group: "chats", icon: "search", shortcut: "Mod+Shift+F", when: never, run: nothing },
    { id: "palette.open", title: "palette: open", group: "palette", icon: "command", shortcut: "Mod+K", global: true, run: deps.openPalette },
  ]
}
