import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, verdict } from "../helpers"
import { hardState, launchHard, runHardOracle } from "./hard-support"

const NOTES = [
  "call the dentist on Tuesday",
  "renew the domain before Friday",
  "send the invoice to the accountant",
  "book the train for the offsite",
  "water the plants in the office",
]

const noteFor = (seed: number): string => pick(mulberry32(seed), NOTES)

export const desktopWindows: Task = {
  id: "desktop-010-second-window",
  track: "desktop",
  os: ["linux", "macos"],
  needs: ["display"],
  heldOut: false,
  kind: "edge",
  prompt: "In the open window, open the notes window and save the note in request.json.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await launchHard(m, "second_window", {}, { note: noteFor(seed) })
  },
  oracle: (m) => runHardOracle(m, "second_window"),
  check: async (m, seed) => {
    const expected = noteFor(seed)
    const state = await hardState(m)
    return verdict([check("note", state?.note === expected, `state.note = ${JSON.stringify(state?.note)}`)])
  },
}
