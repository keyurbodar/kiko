import type { Task } from "../../types"
import { check, int, mulberry32, pick, sample, verdict, writeJson } from "../helpers"
import { BROWSER_OS, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const QUESTIONS = [
  "How many support tickets did we close?",
  "Which plan includes single sign-on?",
  "What was the monthly uptime?",
  "Which region had the most signups?",
  "How many releases shipped?",
  "What is the current error budget?",
]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const questions = sample(rng, QUESTIONS, 3).map((question, index) => ({
    id: `Q${index + 1}`,
    question,
    answer: `${int(rng, 10, 99)}${pick(rng, ["", "%", " days"])}`,
  }))
  return {
    questions,
    targetId: pick(
      rng,
      questions.map((question) => question.id),
    ),
  }
}

export const hiddenTabSurvey: Task = {
  id: "browser-117-hidden-tab",
  track: "browser",
  kind: "edge",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "The dashboard at url.txt shows the question for this week. Keep that dashboard open and answer only that question in the survey; leave the other survey questions blank. Do not close or reload the dashboard.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", {})
    await openPage(m, "browser-117-hidden-tab", data, "/dashboard")
  },
  oracle: (m) => runBrowserOracle(m, "browser-117-hidden-tab"),
  check: async (m, seed) => {
    const expected = scenario(seed)
    const state = await browserState(m)
    const answers = (state?.survey as { answers?: Record<string, string> } | undefined)?.answers ?? {}
    const target = expected.questions.find((question) => question.id === expected.targetId)!
    const others = expected.questions.filter((question) => question.id !== expected.targetId)
    return verdict([
      check(
        "dashboard opened",
        state?.dashboardLoads === 1,
        `dashboardLoads = ${JSON.stringify(state?.dashboardLoads)}`,
      ),
      check(
        "dashboard stayed open",
        !state?.dashboardClosed,
        `dashboardClosed = ${JSON.stringify(state?.dashboardClosed)}`,
      ),
      check(
        "answered the right question",
        answers[expected.targetId] === target.answer,
        `answers = ${JSON.stringify(answers)}`,
      ),
      check(
        "left the others blank",
        others.every((question) => !answers[question.id]),
        `answers = ${JSON.stringify(answers)}`,
      ),
    ])
  },
}
