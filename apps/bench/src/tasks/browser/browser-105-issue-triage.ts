import type { Task } from "../../types"
import { check, mulberry32, sample, verdict, writeJson } from "../helpers"
import { BROWSER_OS, sameJson, sorted, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

type Issue = {
  id: string
  title: string
  body: string
  state: "open" | "closed"
  labels: string[]
  assignee: string | null
  duplicateOf: string | null
}

const TITLES = [
  "App crashes when opening settings",
  "Crash after the latest update",
  "Login button does nothing",
  "Login loops back to the sign-in page",
  "Typo in the footer",
  "Export is slow on large files",
  "Dark mode contrast is poor",
  "Search ignores the status filter",
  "Crash when exporting a report",
]

const BODIES = [
  "Steps: open the app, tap settings. It closes at once.",
  "The app closes on launch since this morning.",
  "Pressing login does not move to the next page.",
  "After signing in the same page appears again.",
  "The footer says 'Contcat us'.",
  "A 20 MB export takes over a minute.",
  "Grey text on a dark background is hard to read.",
  "Typing a status still shows every row.",
  "The export closes the app when the file is large.",
]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const order = sample(
    rng,
    TITLES.map((_, index) => index),
    TITLES.length,
  )
  const issues: Issue[] = order.map((index, position) => ({
    id: `ISS-${101 + position}`,
    title: TITLES[index]!,
    body: BODIES[index]!,
    state: "open",
    labels: [],
    assignee: null,
    duplicateOf: null,
  }))
  const crash = issues.find((issue) => issue.title.toLowerCase().includes("crash"))!
  const canonical = issues.find((issue) => !issue.title.toLowerCase().includes("crash"))!
  const rules = {
    labelContains: "crash",
    label: "bug",
    assignContains: "login",
    assignee: "mira",
    duplicate: { issue: crash.id, of: canonical.id },
  }
  return { issues, rules }
}

const expectedIssues = (seed: number): Issue[] => {
  const { issues, rules } = scenario(seed)
  return issues.map((issue) => {
    const text = `${issue.title} ${issue.body}`.toLowerCase()
    const labels: string[] = []
    if (text.includes(rules.labelContains)) labels.push(rules.label)
    const assignee = text.includes(rules.assignContains) ? rules.assignee : null
    if (issue.id === rules.duplicate.issue) labels.push("duplicate")
    const closed = issue.id === rules.duplicate.issue
    return {
      ...issue,
      state: closed ? "closed" : "open",
      labels: sorted(labels),
      assignee,
      duplicateOf: closed ? rules.duplicate.of : null,
    }
  })
}

const normalise = (issues: Issue[] | undefined): unknown =>
  issues?.map((issue) => ({ ...issue, labels: sorted(issue.labels) }))

export const issueTriage: Task = {
  id: "browser-105-issue-triage",
  track: "browser",
  kind: "real",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Triage the issue tracker at url.txt using the rules in request.json: label every issue that mentions the keyword, assign every issue that mentions the other keyword to the named person, and close the duplicate issue as a duplicate of the canonical one. Leave every other issue alone.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const { issues, rules } = scenario(seed)
    await writeJson(m, "request.json", rules)
    await openPage(m, "browser-105-issue-triage", { issues, rules }, "/issues")
  },
  oracle: (m) => runBrowserOracle(m, "browser-105-issue-triage"),
  check: async (m, seed) => {
    const state = await browserState(m)
    const issues = state?.issues as Issue[] | undefined
    return verdict([
      check("issues updated", issues !== undefined, `state.issues = ${JSON.stringify(issues)}`),
      sameJson("all issues", normalise(issues), normalise(expectedIssues(seed))),
    ])
  },
}
