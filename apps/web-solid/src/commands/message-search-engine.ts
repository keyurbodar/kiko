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

export const searchEngine = {
  type: (query: string) => search.type(query),
  status: () => search.view()?.status,
  choices: (open: (hit: Hit) => void): Choice[] => (search.view()?.hits ?? []).map((hit) => choice(hit, open)),
}
