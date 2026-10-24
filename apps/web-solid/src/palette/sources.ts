import { KIKO } from "@kiko/protocol"
import { history, openChat } from "../app/history"
import { openFile } from "../chat/side/surfaces"
import { type Choice, type Command, type RowAction } from "../commands/registry"
import { withMade } from "../files/api"
import { HOME, where } from "../files/model"
import { recentFiles } from "../files/recent"
import { agentList } from "../lib/chats"
import { agentDisplayName } from "../lib/names"
import { askDeleteChat, startRename, togglePin } from "../sidebar/actions"
import { markedUnread } from "../sidebar/unread-mark"
import { openSettings } from "../settings/open"
import { SETTINGS_SECTIONS } from "../settings/sections"
import { cards, installs } from "../recipes/state"
import { room } from "../state/room"
import { user } from "../state/user"
import { commandItem, listed, type Item } from "./model"

export interface FileEntry {
  path: string
  name: string
  size: number
  fileId: string
  space: string
  home: boolean
}

const chatActions = (id: string): readonly RowAction[] => {
  const pinnable = !user.chat(id)?.kiko
  const pinned = user.chat(id)?.pinned
  return [
    { id: "open", title: "Open", icon: "chevron", run: () => openChat(id) },
    ...(pinnable
      ? [{ id: "pin", title: pinned ? "Unpin" : "Pin", icon: "pin", run: () => togglePin(id) } satisfies RowAction]
      : []),
    {
      id: "link",
      title: "Copy link",
      icon: "copy",
      run: () => void navigator.clipboard?.writeText(`${window.location.origin}/chat/${id}`),
    },
    {
      id: "rename",
      title: "Rename",
      icon: "edit",
      run: () => {
        openChat(id)
        startRename(id)
      },
    },
    ...(pinnable
      ? [
          {
            id: "delete",
            title: "Delete",
            icon: "trash",
            danger: true,
            run: () => askDeleteChat(id),
          } satisfies RowAction,
        ]
      : []),
  ]
}

const needsYou = (bot: { id: string; unread: number }): boolean => bot.unread > 0 || markedUnread(bot.id)

export function chatChoices(): Choice[] {
  return room.bots().map((bot) => ({
    id: bot.id,
    title: bot.name,
    chatId: bot.id,
    from: bot.previewFrom,
    detail: bot.preview,
    meta: bot.unread > 0 ? `${bot.unread} new` : undefined,
    at: bot.updatedAt,
    actions: () => chatActions(bot.id),
    run: () => openChat(bot.id),
  }))
}

export function unreadChats(): Choice[] {
  return room
    .bots()
    .filter(needsYou)
    .map((bot) => ({
      id: `needs.${bot.id}`,
      title: bot.name,
      chatId: bot.id,
      from: bot.previewFrom,
      detail: bot.preview,
      meta: bot.unread > 0 ? `${bot.unread} new` : undefined,
      actions: () => chatActions(bot.id),
      run: () => openChat(bot.id),
    }))
}

export function agentChoices(): Choice[] {
  const live = new Map<string, string>()
  for (const bot of room.bots()) {
    if (bot.presence !== "working" && bot.presence !== "typing") continue
    const ids = user.chat(bot.id)?.agents?.length ? user.chat(bot.id)!.agents! : [KIKO]
    for (const id of ids)
      if (!live.has(id)) live.set(id, bot.typing ?? (bot.presence === "typing" ? "Typing" : "Working"))
  }
  return agentList(user.agents()).map((agent) => ({
    id: agent.id,
    title: agent.name,
    seed: agent.slug,
    detail: live.get(agent.id) ?? "Idle",
    meta: user.agentModel(agent.slug)?.name,
    run: () => {
      const roomId = user.createChat(agent.name, [agent.id])
      if (roomId) openChat(roomId)
    },
  }))
}

export function recipeChoices(): Choice[] {
  const open = () => history.push("/recipes")
  const have = new Set(installs().map((i) => i.slug))
  const yours = installs().flatMap((install): Choice[] => {
    const card = cards().find((c) => c.slug === install.slug)
    if (!card) return []
    return [
      {
        id: `${install.slug}.${install.roomId}.${install.agent}`,
        title: card.title,
        icon: "leaf",
        detail: card.description,
        meta: agentDisplayName(install.agent, user.agents()),
        group: "Yours",
        run: open,
      },
    ]
  })
  const templates = cards()
    .filter((c) => !have.has(c.slug))
    .map((card): Choice => ({
      id: `template.${card.slug}`,
      title: card.title,
      icon: "leaf",
      detail: card.description,
      group: "Templates",
      run: open,
    }))
  return [...yours, ...templates]
}

export const settingsChoices = (): Choice[] =>
  SETTINGS_SECTIONS.map((s) => ({
    id: s.id,
    title: s.label,
    glyph: s.icon,
    detail: s.hint,
    run: () => openSettings(s.id),
  }))

export function fileEntries(): FileEntry[] {
  const chatId = room.activeId() ?? user.kikoChatId()
  if (!chatId) return []
  const chat = withMade(chatId, room.files()).map((f): FileEntry => ({
    path: f.name,
    name: f.name,
    size: f.size,
    fileId: f.id,
    space: chatId,
    home: false,
  }))
  const home = withMade(HOME, user.homeFiles()).map((f): FileEntry => ({
    path: `${HOME}/${f.name}`,
    name: f.name,
    size: f.size,
    fileId: f.id,
    space: where(chatId, `${HOME}/${f.name}`).space,
    home: true,
  }))
  return [...chat, ...home]
}

const filesChatId = (): string | null => room.activeId() ?? user.kikoChatId() ?? null

export function openEntry(entry: FileEntry): void {
  const chatId = filesChatId()
  if (!chatId) return
  if (room.activeId() !== chatId) openChat(chatId)
  openFile(chatId, entry.path)
}

export const recentPaths = (): readonly string[] => {
  const chatId = filesChatId()
  return chatId ? recentFiles(chatId) : []
}

const PRIORITY = ["chat.new", "chat.model", "chats.go", "chats.search-all", "settings.open"]

export function doItems(list: readonly Command[]): {
  all: Item[]
  priority: Item[]
  agents: Item[]
  settings: Item[]
} {
  const all = listed(list).map((c) => ({ id: c.id as string, item: commandItem(c) }))
  const pick = (ids: readonly string[]) => ids.flatMap((id) => all.find((x) => x.id === id)?.item ?? [])
  const rest = all.filter((x) => !PRIORITY.includes(x.id)).map((x) => x.item)
  return {
    all: all.map((x) => x.item),
    priority: [...pick(PRIORITY), ...rest],
    agents: [
      ...pick(["chat.new-agent"]),
      { key: "agent-settings", title: "Agent settings", icon: "settings", run: () => openSettings("models") },
    ],
    settings: pick(["chat.model", "chat.reasoning", "theme.change", "account.sign-out"]),
  }
}
