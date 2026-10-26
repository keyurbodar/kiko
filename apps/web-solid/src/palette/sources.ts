import { KIKO } from "@kiko/protocol"
import { history, openChat } from "../app/history"
import { openFile } from "../chat/side/surfaces"
import { type Choice, type Command, type RowAction } from "../commands/registry"
import { library } from "../files/library"
import { recentFiles } from "../files/recent"
import { agentList } from "../lib/chats"
import { agentDisplayName } from "../lib/names"
import { askDeleteChat, startRename, togglePin } from "../sidebar/actions"
import { needsOf, type Need } from "../sidebar/needs"
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
  chat?: { roomId: string; path: string }
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

const needsHere = (): ReadonlyMap<string, Need> =>
  needsOf({
    activeId: room.activeId(),
    asks: room.active()?.asks() ?? [],
    messages: room.messages(),
    retry: room.retryRun,
    elsewhere: new Map(),
  })

export function unreadChats(): Choice[] {
  const needs = needsHere()
  const waiting = (bot: { id: string; unread: number }) => bot.unread > 0 || markedUnread(bot.id) || needs.has(bot.id)
  return room
    .bots()
    .filter(waiting)
    .sort((a, b) => Number(needs.has(b.id)) - Number(needs.has(a.id)))
    .map((bot) => {
      const need = needs.get(bot.id)
      return {
        id: `needs.${bot.id}`,
        title: bot.name,
        chatId: bot.id,
        ...(need ? {} : { from: bot.previewFrom }),
        detail: need?.text ?? bot.preview,
        meta: need?.kind === "failed" ? "Failed" : bot.unread > 0 ? `${bot.unread} new` : undefined,
        ...(need?.kind === "failed" ? { tone: "bad" as const } : {}),
        actions: () => chatActions(bot.id),
        run: () => openChat(bot.id),
      }
    })
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

const IN_CHATS = "In your chats"

const filesChatId = (): string | null => room.activeId() ?? user.kikoChatId() ?? null

const folderName = (name: string) => name.replaceAll("/", "-").trim() || "Untitled chat"

export function fileEntries(): FileEntry[] {
  library.want()
  const chatId = filesChatId()
  if (!chatId) return []
  return library.files().map((f): FileEntry => {
    const base = { name: f.file.name, size: f.file.size, fileId: f.file.id, space: f.space }
    if (f.roomId === null) return { ...base, path: f.path, home: true }
    if (f.roomId === chatId) return { ...base, path: f.path, home: false }
    const chat = room.chatById(f.roomId)?.name ?? user.chat(f.roomId)?.title ?? ""
    return {
      ...base,
      path: `${IN_CHATS}/${folderName(chat)}/${f.path}`,
      home: false,
      chat: { roomId: f.roomId, path: f.path },
    }
  })
}

export function openEntry(entry: FileEntry): void {
  const chatId = entry.chat?.roomId ?? filesChatId()
  if (!chatId) return
  if (room.activeId() !== chatId) openChat(chatId)
  openFile(chatId, entry.chat?.path ?? entry.path)
}

export const recentPaths = (): readonly string[] => {
  const chatId = filesChatId()
  return chatId ? recentFiles(chatId) : []
}

const PRIORITY = ["chat.new", "chat.model", "settings.open"]
const COVERED_BY_TABS = new Set(["chats.go", "chats.search-all"])

export function doItems(list: readonly Command[]): {
  all: Item[]
  priority: Item[]
  agents: Item[]
  settings: Item[]
} {
  const all = listed(list).map((c) => ({ id: c.id as string, item: commandItem(c) }))
  const pick = (ids: readonly string[]) => ids.flatMap((id) => all.find((x) => x.id === id)?.item ?? [])
  const rest = all.filter((x) => !PRIORITY.includes(x.id) && !COVERED_BY_TABS.has(x.id)).map((x) => x.item)
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
