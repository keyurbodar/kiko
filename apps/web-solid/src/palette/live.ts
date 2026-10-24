import { createMemo } from "solid-js"
import { messageRows } from "../commands/message-search"
import { commands } from "../commands/registry"
import { openHit } from "./ask"
import {
  agentChoices,
  chatChoices,
  doItems,
  fileEntries,
  openEntry,
  recentPaths,
  recipeChoices,
  settingsChoices,
  unreadChats,
} from "./sources"
import { filesFolder, openFolder } from "./state"
import type { TabData } from "./tabs"

export function liveSource(): TabData {
  const doSet = createMemo(() => doItems(commands()))
  return {
    get chats() {
      return chatChoices()
    },
    get unread() {
      return unreadChats()
    },
    get agents() {
      return agentChoices()
    },
    get recipes() {
      return recipeChoices()
    },
    get settings() {
      return settingsChoices()
    },
    get messages() {
      return messageRows(openHit)
    },
    get files() {
      return fileEntries()
    },
    get recent() {
      return recentPaths()
    },
    get folder() {
      return filesFolder()
    },
    get commands() {
      return doSet().all
    },
    get doCommands() {
      return doSet().priority
    },
    get agentDo() {
      return doSet().agents
    },
    get settingsDo() {
      return doSet().settings
    },
    get now() {
      return Date.now()
    },
    open: (entry) => openEntry(entry),
    enter: (path) => openFolder(path.split("/")),
  }
}
