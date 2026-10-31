import type { Task } from "../../types"
import { check, mulberry32, pick, sample, verdict, writeJson } from "../helpers"
import { BROWSER_OS, sameJson, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const COLUMNS = ["Backlog", "Doing", "Review", "Done"]
const TITLES = [
  "Write the release note",
  "Fix the flaky login test",
  "Draft the pricing page",
  "Review the incident report",
  "Update the onboarding email",
  "Trim the export query",
  "Add the billing warning",
  "Refresh the support macros",
  "Document the retry policy",
  "Remove the old banner",
]

type Card = { id: string; title: string; column: string }

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const cards: Card[] = sample(rng, TITLES, 8).map((title, index) => ({
    id: `CARD-${index + 1}`,
    title,
    column: pick(rng, COLUMNS),
  }))
  const chosen = sample(
    rng,
    cards.map((card) => card.id),
    3,
  )
  const moves = chosen.map((id) => {
    const card = cards.find((entry) => entry.id === id)!
    const to = pick(
      rng,
      COLUMNS.filter((column) => column !== card.column),
    )
    return { card: id, to }
  })
  const expected = { columns: COLUMNS, cards: structuredClone(cards) }
  for (const move of moves) {
    const card = expected.cards.find((entry) => entry.id === move.card)!
    card.column = move.to
    expected.cards = [...expected.cards.filter((entry) => entry.id !== card.id), card]
  }
  return { columns: COLUMNS, cards, moves, expected }
}

export const kanbanDrag: Task = {
  id: "browser-110-kanban-drag",
  track: "browser",
  kind: "edge",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Move the cards on the board at url.txt as request.json says, one card per move. Drag each card into the named column and leave every other card where it is.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", data.moves)
    await openPage(
      m,
      "browser-110-kanban-drag",
      { columns: data.columns, cards: data.cards, moves: data.moves },
      "/board",
    )
  },
  oracle: (m) => runBrowserOracle(m, "browser-110-kanban-drag"),
  check: async (m, seed) => {
    const state = await browserState(m)
    const expected = scenario(seed).expected
    return verdict([
      check("board moved", state?.board !== undefined, `board = ${JSON.stringify(state?.board)}`),
      sameJson("board", state?.board, expected),
    ])
  },
}
