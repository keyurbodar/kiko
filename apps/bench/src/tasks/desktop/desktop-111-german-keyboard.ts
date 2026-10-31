import type { Task } from "../../types"
import { check, mulberry32, pick, verdict } from "../helpers"
import { hardState, launchHard, HARD_LIMITS, runHardOracle } from "./hard-support"

const PHRASES = ["Grüße aus München", "Jörg prüft die Größe", "Über 30 Äpfel", "Straße Nummer fünf", "Bäcker Ölmann"]

const phraseFor = (seed: number): string => pick(mulberry32(seed), PHRASES)

export const desktopGermanKeyboard: Task = {
  id: "desktop-111-german-keyboard",
  track: "desktop",
  kind: "edge",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "The computer is set to a German keyboard layout. Type the phrase from request.json into the field exactly as written and save.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    await launchHard(m, "text", {}, { text: phraseFor(seed) }, { layout: "de" })
  },
  oracle: (m) => runHardOracle(m, "text"),
  check: async (m, seed) => {
    const expected = phraseFor(seed)
    const state = await hardState(m)
    return verdict([check("phrase", state?.text === expected, `text = ${JSON.stringify(state?.text)}`)])
  },
}
