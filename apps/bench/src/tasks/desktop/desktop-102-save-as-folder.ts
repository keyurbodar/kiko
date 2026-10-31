import type { Task } from "../../types"
import { check, mulberry32, pick, readText, run, verdict } from "../helpers"
import { HARD_LIMITS, hardState, launchHard, runHardOracle } from "./hard-support"

const NOTES = [
  "Book the room for Thursday and tell the team.",
  "The invoice is due on the 12th; pay it from the ops account.",
  "Ask the supplier for a new quote before we renew.",
  "Move the standup to 9:30 while the office is closed.",
]

const noteFor = (seed: number): string => pick(mulberry32(seed), NOTES)

export const desktopSaveAs: Task = {
  id: "desktop-102-save-as-folder",
  track: "desktop",
  kind: "real",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "The note is open in the text editor. Use Save As to save it as note.txt inside the archive folder, without changing the text.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    await run(m, ["mkdir", "-p", `${m.workdir}/archive`])
    await launchHard(m, "saveas", { text: noteFor(seed) }, { name: "note.txt" })
  },
  oracle: (m) => runHardOracle(m, "saveas"),
  check: async (m, seed) => {
    const expected = noteFor(seed)
    const saved = await readText(m, "archive/note.txt")
    const stray = await readText(m, "note.txt")
    const state = await hardState(m)
    return verdict([
      check(
        "saved into archive",
        saved === expected,
        `archive/note.txt was ${JSON.stringify(saved)}; saved_path was ${JSON.stringify(state?.saved_path)}`,
      ),
      check("nothing saved at the root", stray === undefined, `note.txt at the root was ${JSON.stringify(stray)}`),
    ])
  },
}
