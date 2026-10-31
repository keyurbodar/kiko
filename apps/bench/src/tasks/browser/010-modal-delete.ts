import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, pick, sample, verdict, writeJson } from "../helpers"
import { browserState, openPage, runBrowserOracle } from "./support"

const TOPICS = [
  "launch plan",
  "pricing memo",
  "hiring note",
  "release notes",
  "support reply",
  "budget draft",
  "roadmap",
  "incident report",
]

const inbox = (seed: number) => {
  const rng = mulberry32(seed)
  const drafts = sample(rng, TOPICS, 5).map((topic) => ({
    id: `DRF-${int(rng, 1000, 9999)}`,
    title: `${topic} ${int(rng, 1, 9)}`,
  }))
  return { drafts, title: pick(rng, drafts).title }
}

export const modalDelete: Task = {
  id: "browser-010-modal-delete",
  track: "browser",
  os: ["linux", "macos", "windows"],
  needs: ["chrome"],
  heldOut: false,
  prompt: "Delete the draft titled in request.json from the drafts page in url.txt. Leave the other drafts alone.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const data = inbox(seed)
    await writeJson(m, "request.json", { title: data.title })
    await openPage(m, "browser-010-modal-delete", data, "/drafts")
  },
  oracle: (m) => runBrowserOracle(m, "browser-010-modal-delete"),
  check: async (m, seed) => {
    const data = inbox(seed)
    const target = data.drafts.find((draft) => draft.title === data.title)
    const deleted = (await browserState(m))?.deleted as string[] | undefined
    return verdict([
      check("deleted once", deleted?.length === 1, `state.deleted = ${JSON.stringify(deleted)}`),
      check(
        "deleted the right draft",
        deleted?.[0] === target?.id,
        `deleted = ${JSON.stringify(deleted?.[0])}, wanted ${target?.id}`,
      ),
    ])
  },
}
