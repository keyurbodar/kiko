import type { Command } from "./registry"

/*
 * kat's command map (screenshot 20). Titles are lowercase `noun: verb`.
 * Every command here does something. `chat: share` and message search are left
 * out: kiko has no share links, and search has no screen yet.
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
  /** The open chat may be pinned, unpinned, or deleted: it is not the kiko chat. */
  canMove: () => boolean
}): Command[] {
  return [
    { id: "view.toggle-sidebar", title: "view: toggle sidebar", group: "view", icon: "menu", shortcut: "Mod+S", global: true, run: deps.toggleSidebar },
    { id: "chat.new", title: "chat: new", group: "chat", icon: "plus", shortcut: "Mod+N", alias: "Mod+T", run: deps.newChat },
    { id: "chat.new-group", title: "chat: new group", group: "chat", icon: "plus", run: deps.newGroup },
    { id: "chat.reopen", title: "chat: reopen closed", group: "chat", icon: "undo", shortcut: "Mod+Shift+T", run: deps.reopenClosed },
    { id: "chat.attach", title: "chat: attach file...", group: "chat", icon: "attach", shortcut: "Mod+O", when: deps.hasActiveChat, run: deps.attach },
    { id: "chat.rename", title: "chat: rename", group: "chat", icon: "edit", shortcut: "F2", when: deps.hasActiveChat, run: deps.rename },
    { id: "chat.pin", title: "chat: pin", group: "chat", icon: "pin", shortcut: "Mod+D", when: deps.canMove, run: deps.togglePin },
    { id: "chat.info", title: "chat: info", group: "chat", icon: "info", shortcut: "Mod+I", global: true, when: deps.hasActiveChat, run: deps.toggleInfo },
    { id: "chat.files", title: "chat: files", group: "chat", icon: "files", shortcut: "Mod+Shift+E", global: true, when: deps.hasActiveChat, run: deps.toggleFiles },
    { id: "chat.close", title: "chat: close", group: "chat", icon: "close", shortcut: "Mod+W", when: deps.hasActiveChat, run: deps.closeChat },
    { id: "chat.delete", title: "chat: delete", group: "chat", icon: "trash", when: deps.canMove, run: deps.deleteChat },
    { id: "chats.go", title: "chats: go to chat...", group: "chats", icon: "chat", shortcut: "Mod+P", global: true, run: deps.openChats },
    // ⌘1 to ⌘9 open the sidebar's chats in order, pinned first, as kat does.
    ...Array.from({ length: 9 }, (_, i): Command => ({
      id: `chats.go-${i + 1}`,
      title: "chats: go to chat",
      group: "chats",
      icon: "chat",
      shortcut: `Mod+${i + 1}`,
      global: true,
      unlisted: true,
      when: () => deps.chatCount() > i,
      run: () => deps.goToChat(i + 1),
    })),
    // Telegram's way through the list without the mouse.
    { id: "chats.previous", title: "chats: previous chat", group: "chats", icon: "chat", shortcut: "Alt+ArrowUp", global: true, when: () => deps.chatCount() > 1, run: () => deps.stepChat(-1) },
    { id: "chats.next", title: "chats: next chat", group: "chats", icon: "chat", shortcut: "Alt+ArrowDown", global: true, when: () => deps.chatCount() > 1, run: () => deps.stepChat(1) },
    { id: "palette.open", title: "palette: open", group: "palette", icon: "command", shortcut: "Mod+K", global: true, run: deps.openPalette },
  ]
}
