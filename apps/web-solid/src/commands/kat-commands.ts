import type { Command } from "./registry"

/*
 * kat's command map (screenshot 20). Titles are sentence case; the palette shows the group as a heading.
 * Every command here does something. Share is left out: kiko has no share links.
 */

/** The pure part: the table of commands, given what they act on. */
export function katCommands(deps: {
  toggleSidebar: () => void
  newChat: () => void
  newGroup: () => void
  closeChat: () => void
  hasActiveChat: () => boolean
  toggleInfo: () => void
  toggleFiles: () => void
  openPalette: () => void
  openChats: () => void
  reopenClosed: () => void
  attach: () => void
  rename: () => void
  togglePin: () => void
  deleteChat: () => void
  /** Opens the nth chat (from 1) in the sidebar's order. */
  goToChat: (n: number) => void
  /** Opens the chat one step up (-1) or down (1) the sidebar from the open one. */
  stepChat: (step: 1 | -1) => void
  /** How many chats the sidebar lists. */
  chatCount: () => number
  /** Opens message search over the open chat, or over every chat. */
  searchChat: () => void
  searchAll: () => void
  /** The open chat may be pinned, unpinned, or deleted: it is not the kiko chat. */
  canMove: () => boolean
}): Command[] {
  return [
    { id: "view.toggle-sidebar", title: "Toggle sidebar", group: "view", icon: "menu", shortcut: "Mod+\\", global: true, run: deps.toggleSidebar },
    { id: "chat.new", title: "New chat", group: "chat", icon: "plus", shortcut: "Mod+N", run: deps.newChat },
    { id: "chat.new-group", title: "New group", group: "chat", icon: "plus", run: deps.newGroup },
    { id: "chat.reopen", title: "Reopen closed chat", group: "chat", icon: "undo", run: deps.reopenClosed },
    { id: "chat.attach", title: "Attach file…", group: "chat", icon: "attach", shortcut: "Mod+O", when: deps.hasActiveChat, run: deps.attach },
    { id: "chat.rename", title: "Rename chat", group: "chat", icon: "edit", shortcut: "F2", when: deps.hasActiveChat, run: deps.rename },
    { id: "chat.pin", title: "Pin chat", group: "chat", icon: "pin", when: deps.canMove, run: deps.togglePin },
    { id: "chat.info", title: "Right panel", group: "chat", icon: "info", shortcut: "Mod+I", global: true, when: deps.hasActiveChat, run: deps.toggleInfo },
    { id: "chat.files", title: "Files", group: "chat", icon: "files", when: deps.hasActiveChat, run: deps.toggleFiles },
    { id: "chat.close", title: "Close chat", group: "chat", icon: "close", when: deps.hasActiveChat, run: deps.closeChat },
    { id: "chat.delete", title: "Delete chat", group: "chat", icon: "trash", when: deps.canMove, run: deps.deleteChat },
    { id: "chats.go", title: "Go to chat…", group: "chats", icon: "chat", shortcut: "Mod+P", global: true, run: deps.openChats },
    // ⌘1 to ⌘9 open the sidebar's chats in order, pinned first, as kat does.
    ...Array.from({ length: 9 }, (_, i): Command => ({
      id: `chats.go-${i + 1}`,
      title: "Go to chat",
      group: "chats",
      icon: "chat",
      shortcut: `Mod+${i + 1}`,
      global: true,
      unlisted: true,
      when: () => deps.chatCount() > i,
      run: () => deps.goToChat(i + 1),
    })),
    // Telegram's way through the list without the mouse.
    { id: "chats.previous", title: "Previous chat", group: "chats", icon: "chat", shortcut: "Alt+ArrowUp", global: true, when: () => deps.chatCount() > 1, run: () => deps.stepChat(-1) },
    { id: "chats.next", title: "Next chat", group: "chats", icon: "chat", shortcut: "Alt+ArrowDown", global: true, when: () => deps.chatCount() > 1, run: () => deps.stepChat(1) },
    { id: "chats.search-current", title: "Search messages in this chat", group: "chats", icon: "search", shortcut: "Mod+F", global: true, when: deps.hasActiveChat, run: deps.searchChat },
    { id: "chats.search-all", title: "Search all chats", group: "chats", icon: "search", shortcut: "Mod+Shift+F", global: true, run: deps.searchAll },
    { id: "palette.open", title: "Open command palette", group: "palette", icon: "command", shortcut: "Mod+K", global: true, run: deps.openPalette },
  ]
}
