import type { Choice, Command } from "./registry"

/*
 * kat's command map (screenshot 20). Titles are sentence case; the palette shows the group as a heading.
 * Every command here does something. Share is left out: kiko has no share links.
 */

/** The pure part: the table of commands, given what they act on. */
export function katCommands(deps: {
  toggleSidebar: () => void
  newChat: () => void
  closeChat: () => void
  hasActiveChat: () => boolean
  toggleCard: () => void
  /** Opens a tab in the right panel for the open chat. */
  openPanel: (kind: "files" | "memory" | "routines") => void
  toggleSidecar: () => void
  copyLink: () => void
  /** The agents a new chat can start with. */
  agentChoices: () => Choice[]
  /** Opens the palette on one command's submenu. */
  openView: (id: string) => void
  /** Opens the picker that makes a group from several agents. */
  newGroup: () => void
  /** Starts Kiko's new agent flow. */
  newAgent: () => void
  openPalette: () => void
  openChats: () => void
  /** The open chat's files and the home files that match the query, best first. */
  fileSearch: (query: string) => readonly Choice[]
  /** Every chat the sidebar lists, as options for the jump list. */
  chatChoices: () => Choice[]
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
  /** Opens message search over the open chat. */
  searchChat: () => void
  /** The open chat may be pinned, unpinned, or deleted: it is not the kiko chat. */
  canMove: () => boolean
}): Command[] {
  return [
    { id: "view.toggle-sidebar", title: "Toggle sidebar", group: "view", icon: "menu", shortcut: "Mod+\\", global: true, run: deps.toggleSidebar },
    { id: "view.toggle-panel", title: "Toggle right panel", group: "view", icon: "board", when: deps.hasActiveChat, run: deps.toggleSidecar },
    { id: "chat.new", title: "New chat", group: "chat", icon: "plus", shortcut: "Mod+N", global: true, run: deps.newChat },
    { id: "chat.new-with", title: "New chat with…", group: "chat", icon: "plus", placeholder: "New chat with…", submenu: deps.agentChoices, run: () => deps.openView("chat.new-with") },
    { id: "chat.new-group", title: "New group", group: "chat", icon: "plus", run: deps.newGroup },
    { id: "chat.new-agent", title: "New agent", group: "chat", icon: "plus", run: deps.newAgent },
    { id: "chat.reopen", title: "Reopen closed chat", group: "chat", icon: "undo", run: deps.reopenClosed },
    { id: "chat.attach", title: "Attach file…", group: "chat", icon: "attach", shortcut: "Mod+O", when: deps.hasActiveChat, run: deps.attach },
    { id: "chat.rename", title: "Rename chat", group: "chat", icon: "edit", shortcut: "F2", when: deps.hasActiveChat, run: deps.rename },
    { id: "chat.pin", title: "Pin chat", group: "chat", icon: "pin", when: deps.canMove, run: deps.togglePin },
    { id: "chat.info", title: "Chat details", group: "chat", icon: "info", shortcut: "Mod+I", global: true, when: deps.hasActiveChat, run: deps.toggleCard },
    { id: "chat.files", title: "Open files", group: "chat", icon: "files", when: deps.hasActiveChat, run: () => deps.openPanel("files") },
    { id: "chat.memory", title: "Open memory", group: "chat", icon: "info", when: deps.hasActiveChat, run: () => deps.openPanel("memory") },
    { id: "chat.routines", title: "Open routines", group: "chat", icon: "board", when: deps.hasActiveChat, run: () => deps.openPanel("routines") },
    { id: "chat.copy-link", title: "Copy chat link", group: "chat", icon: "attach", when: deps.hasActiveChat, run: deps.copyLink },
    { id: "chat.close", title: "Close chat", group: "chat", icon: "close", when: deps.hasActiveChat, run: deps.closeChat },
    { id: "chat.delete", title: "Delete chat", group: "chat", icon: "trash", when: deps.canMove, run: deps.deleteChat },
    { id: "chats.go", title: "Go to chat…", group: "chats", icon: "chat", shortcut: "Mod+P", global: true, placeholder: "Go to chat…", submenu: deps.chatChoices, run: deps.openChats },
    // Mod+O attaches a file and Mod+P is the chat jump, so the file jump takes Mod+Shift+O.
    {
      id: "files.go",
      title: "Go to file…",
      group: "go",
      icon: "files",
      shortcut: "Mod+Shift+O",
      global: true,
      when: deps.hasActiveChat,
      placeholder: "Search files…",
      search: deps.fileSearch,
      enter: "Open file",
      highlight: true,
      empty: { none: "No files yet", noMatch: "No matching files" },
      run: () => deps.openView("files.go"),
    },
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
    { id: "palette.open", title: "Open command palette", group: "palette", icon: "command", shortcut: "Mod+K", global: true, run: deps.openPalette },
  ]
}
