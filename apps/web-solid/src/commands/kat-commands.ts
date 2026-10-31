import { CHAT_SLOTS } from "./ids"
import type { Choice, Command, CommandId } from "./registry"

export function katCommands(deps: {
  mac: boolean
  toggleSidebar: () => void
  newChat: () => void
  closeChat: () => void
  hasActiveChat: () => boolean
  toggleCard: () => void
  openPanel: (kind: "files" | "memory" | "routines") => void
  copyLink: () => void
  agentChoices: () => Choice[]
  openView: (id: CommandId) => void
  newGroup: () => void
  newAgent: () => void
  openPalette: () => void
  openChats: () => void
  fileSearch: (query: string) => readonly Choice[]
  chatChoices: () => Choice[]
  reopenClosed: () => void
  attach: () => void
  rename: () => void
  togglePin: () => void
  deleteChat: () => void
  goToChat: (n: number) => void
  stepChat: (step: 1 | -1) => void
  chatCount: () => number
  searchChat: () => void
  canMove: () => boolean
}): Command[] {
  return [
    {
      id: "view.toggle-sidebar",
      title: "Toggle sidebar",
      group: "view",
      icon: "menu",
      shortcut: "Mod+\\",
      global: true,
      run: deps.toggleSidebar,
    },
    {
      id: "chat.new",
      title: "New chat",
      group: "chat",
      icon: "plus",
      shortcut: "Mod+Shift+O",
      global: true,
      run: deps.newChat,
    },
    {
      id: "chat.new-with",
      title: "New chat with…",
      group: "chat",
      icon: "plus",
      placeholder: "New chat with…",
      submenu: deps.agentChoices,
      run: () => deps.openView("chat.new-with"),
    },
    { id: "chat.new-group", title: "New group", group: "chat", icon: "plus", run: deps.newGroup },
    { id: "chat.new-agent", title: "New agent", group: "chat", icon: "plus", run: deps.newAgent },
    { id: "chat.reopen", title: "Reopen closed chat", group: "chat", icon: "undo", run: deps.reopenClosed },
    {
      id: "chat.attach",
      title: "Attach file…",
      group: "chat",
      icon: "attach",
      shortcut: "Mod+O",
      global: true,
      when: deps.hasActiveChat,
      run: deps.attach,
    },
    {
      id: "chat.rename",
      title: "Rename chat",
      group: "chat",
      icon: "edit",
      shortcut: "F2",
      when: deps.hasActiveChat,
      run: deps.rename,
    },
    { id: "chat.pin", title: "Pin chat", group: "chat", icon: "pin", when: deps.canMove, run: deps.togglePin },
    {
      id: "chat.info",
      title: "Show chat details",
      group: "chat",
      icon: "info",
      shortcut: "Mod+I",
      when: deps.hasActiveChat,
      run: deps.toggleCard,
    },
    {
      id: "chat.files",
      title: "Open files",
      group: "chat",
      icon: "files",
      when: deps.hasActiveChat,
      run: () => deps.openPanel("files"),
    },
    {
      id: "chat.memory",
      title: "Open memory",
      group: "chat",
      icon: "info",
      when: deps.hasActiveChat,
      run: () => deps.openPanel("memory"),
    },
    {
      id: "chat.routines",
      title: "Open routines",
      group: "chat",
      icon: "board",
      when: deps.hasActiveChat,
      run: () => deps.openPanel("routines"),
    },
    {
      id: "chat.copy-link",
      title: "Copy chat link",
      group: "chat",
      icon: "attach",
      when: deps.hasActiveChat,
      run: deps.copyLink,
    },
    {
      id: "chat.close",
      title: "Close chat",
      group: "chat",
      icon: "close",
      when: deps.hasActiveChat,
      run: deps.closeChat,
    },
    { id: "chat.delete", title: "Delete chat", group: "chat", icon: "trash", when: deps.canMove, run: deps.deleteChat },
    {
      id: "chats.go",
      title: "Go to chat…",
      group: "chats",
      icon: "chat",
      shortcut: "Mod+P",
      global: true,
      placeholder: "Go to chat…",
      submenu: deps.chatChoices,
      run: deps.openChats,
    },
    {
      id: "files.go",
      title: "Go to file…",
      group: "go",
      icon: "files",
      shortcut: "Mod+Shift+E",
      global: true,
      when: deps.hasActiveChat,
      placeholder: "Search files…",
      search: deps.fileSearch,
      enter: "Open file",
      highlight: true,
      empty: { none: "No files yet", noMatch: "No matching files" },
      run: () => deps.openView("files.go"),
    },
    ...CHAT_SLOTS.map((slot, i): Command => ({
      id: `chats.go-${slot}`,
      title: `Go to chat ${slot}`,
      group: "chats",
      icon: "chat",
      shortcut: `${deps.mac ? "Control" : "Alt"}+${slot}`,
      global: true,
      unlisted: true,
      when: () => deps.chatCount() > i,
      run: () => deps.goToChat(slot),
    })),
    {
      id: "chats.previous",
      title: "Previous chat",
      group: "chats",
      icon: "chat",
      shortcut: "Alt+ArrowUp",
      when: () => deps.chatCount() > 1,
      run: () => deps.stepChat(-1),
    },
    {
      id: "chats.next",
      title: "Next chat",
      group: "chats",
      icon: "chat",
      shortcut: "Alt+ArrowDown",
      when: () => deps.chatCount() > 1,
      run: () => deps.stepChat(1),
    },
    {
      id: "chats.search-current",
      title: "Search messages in this chat",
      group: "chats",
      icon: "search",
      shortcut: "Mod+F",
      global: true,
      when: deps.hasActiveChat,
      run: deps.searchChat,
    },
    {
      id: "palette.open",
      title: "Open command palette",
      group: "palette",
      icon: "command",
      shortcut: "Mod+K",
      global: true,
      run: deps.openPalette,
    },
  ]
}
