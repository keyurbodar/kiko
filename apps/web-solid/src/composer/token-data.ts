import { createMemo } from "solid-js"
import type { RecipeApp } from "@kiko/protocol"
import { withMade } from "../files/api"
import { fileHits, rankFiles } from "../files/go-to"
import { HOME } from "../files/model"
import { recentFiles } from "../files/recent"
import { cards, followRecipes, installs } from "../recipes/state"
import { agentDisplayName } from "../lib/names"
import { room } from "../state/room"
import { user } from "../state/user"
import { skillNames, titleOf, type Token, type TokenPool } from "./tokens"

export type TokenData = Omit<TokenPool, "agents" | "commands"> & { app: (slug: string) => RecipeApp | undefined }

const FILE_HITS = 5

export function createTokenData(input: { roomId: () => string; chatTitle: () => string | undefined }): TokenData {
  followRecipes()
  const connected = createMemo(() => {
    const seen = new Map<string, RecipeApp>()
    for (const card of cards()) for (const app of card.apps) if (app.connected) seen.set(app.slug, app)
    return [...seen.values()]
  })
  const apps = createMemo((): Token[] =>
    connected().map((app) => ({
      kind: "app",
      id: `app:${app.slug}`,
      slug: app.slug,
      title: app.name,
      hint: "Connected",
    })),
  )
  const skills = createMemo((): Token[] =>
    skillNames(room.files().map((file) => file.name)).map((name) => ({
      kind: "skill",
      id: `skill:${name}`,
      name,
      title: titleOf(name),
      hint: "Skill in this chat",
    })),
  )
  const recipes = createMemo((): Token[] => {
    const here = new Map(
      installs().flatMap((install) => (install.roomId === input.roomId() ? [[install.slug, install]] : [])),
    )
    const agents = user.agents()
    return cards()
      .map((card) => {
        const install = here.get(card.slug)
        const hint = install ? `${agentDisplayName(install.agent, agents)}, ${card.when}` : card.when
        return {
          token: { kind: "recipe", id: `recipe:${card.slug}`, name: card.slug, title: card.title, hint } as Token,
          here: !!install,
        }
      })
      .sort((a, b) => Number(b.here) - Number(a.here))
      .map((entry) => entry.token)
  })
  const files = (query: string): Token[] => {
    const id = input.roomId()
    if (!id) return []
    const hits = fileHits(
      withMade(id, room.files()).map((file) => file.name),
      withMade(HOME, user.homeFiles()).map((file) => file.name),
    )
    return rankFiles(hits, query, recentFiles(id), FILE_HITS).map((hit) => ({
      kind: "file",
      id: `file:${hit.path}`,
      path: hit.path,
      title: hit.name,
      hint: hit.home ? "Files" : (input.chatTitle() ?? "This chat"),
    }))
  }
  return {
    files,
    apps,
    skills,
    recipes,
    app: (slug) => connected().find((app) => app.slug === slug),
  }
}
