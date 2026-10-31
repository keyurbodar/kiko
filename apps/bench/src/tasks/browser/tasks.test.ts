import { describe, expect, it } from "vitest"

import { createMachine, localOs, removeMachine } from "../../machine"
import type { Task } from "../../types"
import { checkoutTask } from "./browser-101-checkout"
import { reauthSettings } from "./browser-102-reauth-settings"
import { productCompare } from "./browser-103-product-compare"
import { formFromPdf } from "./browser-104-form-from-pdf"
import { issueTriage } from "./browser-105-issue-triage"
import { researchSixPages } from "./browser-106-research-six-pages"
import { inboxZero } from "./browser-107-inbox-zero"
import { shadowIframe } from "./browser-108-shadow-iframe"
import { infiniteScroll } from "./browser-109-infinite-scroll"
import { kanbanDrag } from "./browser-110-kanban-drag"
import { richText } from "./browser-111-rich-text"
import { oauthPopup } from "./browser-112-oauth-popup"
import { flakyBackend } from "./browser-113-flaky-backend"
import { humanWall } from "./browser-114-human-wall"
import { datePicker } from "./browser-115-date-picker"
import { fileUpload } from "./browser-116-file-upload"
import { hiddenTabSurvey } from "./browser-117-hidden-tab"

const currentOs = localOs()
const runsHere = (task: Task): boolean => task.os.includes(currentOs)

async function expectOraclePasses(task: Task): Promise<void> {
  const machine = await createMachine()
  try {
    await task.setup(machine, 1)
    await task.oracle(machine, 1)
    const verdict = await task.check(machine, 1)
    expect(verdict.checks.length).toBeGreaterThan(0)
    expect(verdict.checks.filter((check) => !check.pass)).toEqual([])
    expect(verdict.pass).toBe(true)
  } finally {
    await removeMachine(machine)
  }
}

async function expectSetupAloneFails(task: Task): Promise<void> {
  const machine = await createMachine()
  try {
    await task.setup(machine, 1)
    const verdict = await task.check(machine, 1)
    expect(verdict.pass).toBe(false)
  } finally {
    await removeMachine(machine)
  }
}

const TASKS: readonly Task[] = [
  checkoutTask,
  reauthSettings,
  productCompare,
  formFromPdf,
  issueTriage,
  researchSixPages,
  inboxZero,
  shadowIframe,
  infiniteScroll,
  kanbanDrag,
  richText,
  oauthPopup,
  flakyBackend,
  humanWall,
  datePicker,
  fileUpload,
  hiddenTabSurvey,
]

describe("hard browser tasks", () => {
  for (const task of TASKS) {
    it.skipIf(!runsHere(task))(`${task.id} passes with the oracle`, () => expectOraclePasses(task))
    it.skipIf(!runsHere(task))(`${task.id} fails without the oracle`, () => expectSetupAloneFails(task))
  }
})
