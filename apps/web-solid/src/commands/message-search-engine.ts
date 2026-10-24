import { createRoot, createSignal } from "solid-js"
import { createSearch, senderName, type Hit, type SearchView } from "../search/model"
import { fetchHits } from "../search/fetch"
import { user } from "../state/user"
import type { Choice } from "./registry"

const search = createRoot(() => {
  const [view, setView] = createSignal<SearchView>()
  const s = createSearch({ scope: "all", fetch: fetchHits, onChange: setView })
  setView(s.view())
  return { ...s, view }
})

const choice = (hit: Hit, open: (hit: Hit) => void): Choice => ({
  id: `${hit.roomId}:${hit.id}`,
  title: `${senderName(hit.from, user.agents())} in ${user.chat(hit.roomId)?.title ?? "Chat"}`,
  snippet: hit.snippet,
  icon: "chat",
  run: () => open(hit),
})

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function ago(at: number): string {
  const age = Date.now() - at
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`
  if (age < MINUTE) return "just now"
  if (age < HOUR) return plural(Math.floor(age / MINUTE), "minute")
  if (age < DAY) return plural(Math.floor(age / HOUR), "hour")
  return plural(Math.floor(age / DAY), "day")
}

const row = (hit: Hit, open: (hit: Hit) => void): Choice => ({
  id: `${hit.roomId}:${hit.id}`,
  title: user.chat(hit.roomId)?.title ?? "Chat",
  chatId: hit.roomId,
  from: senderName(hit.from, user.agents()),
  snippet: hit.snippet,
  meta: ago(hit.at),
  run: () => open(hit),
})

export const searchEngine = {
  rows: (open: (hit: Hit) => void): Choice[] => (search.view()?.hits ?? []).map((hit) => row(hit, open)),
  type: (query: string) => search.type(query),
  status: () => search.view()?.status,
  choices: (open: (hit: Hit) => void): Choice[] => (search.view()?.hits ?? []).map((hit) => choice(hit, open)),
}
