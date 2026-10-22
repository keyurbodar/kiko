import { Navigate, type RouteDefinition, useNavigate, useParams } from "@solidjs/router"
import { createEffect, lazy } from "solid-js"
import { useApp } from "../lib/store"
import { fixedSurface, openFile, openSurface } from "../chat/side/surfaces"
import { openSettings } from "../settings/dialog-state"
import { landingSection } from "../settings/sections"
import { sectionOf } from "./sections"

const pages = {
  chat: lazy(() => import("./routes/chat")),
  recipes: lazy(() => import("../recipes/page")),
  connect: lazy(() => import("./connect")),
}

export function preloadRoute(href: string): void {
  const id = sectionOf(href)
  if (id) void pages[id].preload()
}

const activeChat = () => useApp.activeThreadId() ?? useApp.resumeChat()

function Resume() {
  const navigate = useNavigate()
  void pages.chat.preload()
  createEffect(() => {
    const id = useApp.resumeChat()
    if (id) navigate(`/chat/${id}`, { replace: true })
  })
  return null
}

function MemoryRedirect() {
  const navigate = useNavigate()
  createEffect(() => {
    const chat = activeChat()
    if (!chat) return
    openSurface(chat, fixedSurface("memory"))
    navigate(`/chat/${chat}`, { replace: true })
  })
  return null
}

function FilesRedirect() {
  const params = useParams<{ chatId?: string; path?: string }>()
  const navigate = useNavigate()
  let path: string | null = null
  if (params.path) {
    try {
      path = params.path.split("/").map(decodeURIComponent).join("/")
    } catch {
      path = params.path
    }
  }
  createEffect(() => {
    const chat = params.chatId ?? activeChat()
    if (!chat) return
    path ? openFile(chat, path) : openSurface(chat, fixedSurface("files"))
    navigate(`/chat/${chat}`, { replace: true })
  })
  return null
}

function SettingsRedirect() {
  const params = useParams<{ section?: string }>()
  openSettings(landingSection(params.section?.split("/")[0]))
  const chat = activeChat()
  return <Navigate href={chat ? `/chat/${chat}` : "/chat"} />
}

export const routes: RouteDefinition[] = [
  { path: ["/", "/chat"], component: Resume },
  { path: "/chat/:id", component: pages.chat },
  { path: ["/files", "/files/:chatId", "/files/:chatId/*path"], component: FilesRedirect },
  { path: ["/board", "/board/:chatId"], component: () => <Navigate href="/chat" /> },
  { path: ["/memory", "/memory/:id"], component: MemoryRedirect },
  { path: "/recipes", component: pages.recipes },
  { path: ["/connect", "/connect/callback"], component: pages.connect },
  { path: "/settings/*section", component: SettingsRedirect },
  { path: "/welcome", component: () => <Navigate href="/chat" /> },
  { path: "*", component: () => <Navigate href="/chat" /> },
]
