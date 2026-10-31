import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

import { createMachine, localOs, removeMachine } from "../../machine"
import type { Task } from "../../types"
import { desktopCalcColumn } from "./desktop-101-calc-column"
import { desktopSaveAs } from "./desktop-102-save-as-folder"
import { desktopBatchRename } from "./desktop-103-batch-rename"
import { desktopPreference } from "./desktop-104-app-preference"
import { desktopReport } from "./desktop-105-report-chart"
import { desktopBigForm } from "./desktop-106-big-form"
import { desktopModal } from "./desktop-107-modal-midtask"
import { desktopMinimized } from "./desktop-108-minimized-window"
import { desktopSameTitle } from "./desktop-109-same-title"
import { desktopHidpi } from "./desktop-110-hidpi"
import { desktopGermanKeyboard } from "./desktop-111-german-keyboard"
import { desktopNotification } from "./desktop-112-notification"
import { desktopOwnerTyping } from "./desktop-113-owner-typing"

const currentOs = localOs()
const hasDisplay = currentOs === "linux" && Boolean(process.env.DISPLAY)
const hasLibreOffice = spawnSync("sh", ["-c", "command -v soffice || command -v libreoffice"]).status === 0

const runsHere = (task: Task): boolean => hasDisplay && task.os.includes(currentOs)
const runsCalc = (task: Task): boolean => runsHere(task) && hasLibreOffice

async function expectOraclePasses(task: Task): Promise<void> {
  const machine = await createMachine()
  try {
    await task.setup(machine, 1)
    await task.oracle(machine, 1)
    const verdict = await task.check(machine, 1)
    expect(verdict.checks.length).toBeGreaterThan(0)
    expect(verdict.checks.every((check) => check.pass)).toBe(true)
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

describe("desktop hard tasks", () => {
  it.skipIf(!runsCalc(desktopCalcColumn))("desktop-101-calc-column passes with the oracle", () =>
    expectOraclePasses(desktopCalcColumn),
  )
  it.skipIf(!runsCalc(desktopCalcColumn))("desktop-101-calc-column fails without the oracle", () =>
    expectSetupAloneFails(desktopCalcColumn),
  )

  it.skipIf(!runsHere(desktopSaveAs))("desktop-102-save-as-folder passes with the oracle", () =>
    expectOraclePasses(desktopSaveAs),
  )
  it.skipIf(!runsHere(desktopSaveAs))("desktop-102-save-as-folder fails without the oracle", () =>
    expectSetupAloneFails(desktopSaveAs),
  )

  it.skipIf(!runsHere(desktopBatchRename))("desktop-103-batch-rename passes with the oracle", () =>
    expectOraclePasses(desktopBatchRename),
  )
  it.skipIf(!runsHere(desktopBatchRename))("desktop-103-batch-rename fails without the oracle", () =>
    expectSetupAloneFails(desktopBatchRename),
  )

  it.skipIf(!runsHere(desktopPreference))("desktop-104-app-preference passes with the oracle", () =>
    expectOraclePasses(desktopPreference),
  )
  it.skipIf(!runsHere(desktopPreference))("desktop-104-app-preference fails without the oracle", () =>
    expectSetupAloneFails(desktopPreference),
  )

  it.skipIf(!runsCalc(desktopReport))("desktop-105-report-chart passes with the oracle", () =>
    expectOraclePasses(desktopReport),
  )
  it.skipIf(!runsCalc(desktopReport))("desktop-105-report-chart fails without the oracle", () =>
    expectSetupAloneFails(desktopReport),
  )

  it.skipIf(!runsHere(desktopBigForm))("desktop-106-big-form passes with the oracle", () =>
    expectOraclePasses(desktopBigForm),
  )
  it.skipIf(!runsHere(desktopBigForm))("desktop-106-big-form fails without the oracle", () =>
    expectSetupAloneFails(desktopBigForm),
  )

  it.skipIf(!runsHere(desktopModal))("desktop-107-modal-midtask passes with the oracle", () =>
    expectOraclePasses(desktopModal),
  )
  it.skipIf(!runsHere(desktopModal))("desktop-107-modal-midtask fails without the oracle", () =>
    expectSetupAloneFails(desktopModal),
  )

  it.skipIf(!runsHere(desktopMinimized))("desktop-108-minimized-window passes with the oracle", () =>
    expectOraclePasses(desktopMinimized),
  )
  it.skipIf(!runsHere(desktopMinimized))("desktop-108-minimized-window fails without the oracle", () =>
    expectSetupAloneFails(desktopMinimized),
  )

  it.skipIf(!runsHere(desktopSameTitle))("desktop-109-same-title passes with the oracle", () =>
    expectOraclePasses(desktopSameTitle),
  )
  it.skipIf(!runsHere(desktopSameTitle))("desktop-109-same-title fails without the oracle", () =>
    expectSetupAloneFails(desktopSameTitle),
  )

  it.skipIf(!runsHere(desktopHidpi))("desktop-110-hidpi passes with the oracle", () => expectOraclePasses(desktopHidpi))
  it.skipIf(!runsHere(desktopHidpi))("desktop-110-hidpi fails without the oracle", () =>
    expectSetupAloneFails(desktopHidpi),
  )

  it.skipIf(!runsHere(desktopGermanKeyboard))("desktop-111-german-keyboard passes with the oracle", () =>
    expectOraclePasses(desktopGermanKeyboard),
  )
  it.skipIf(!runsHere(desktopGermanKeyboard))("desktop-111-german-keyboard fails without the oracle", () =>
    expectSetupAloneFails(desktopGermanKeyboard),
  )

  it.skipIf(!runsHere(desktopNotification))("desktop-112-notification passes with the oracle", () =>
    expectOraclePasses(desktopNotification),
  )
  it.skipIf(!runsHere(desktopNotification))("desktop-112-notification fails without the oracle", () =>
    expectSetupAloneFails(desktopNotification),
  )

  it.skipIf(!runsHere(desktopOwnerTyping))("desktop-113-owner-typing passes with the oracle", () =>
    expectOraclePasses(desktopOwnerTyping),
  )
  it.skipIf(!runsHere(desktopOwnerTyping))("desktop-113-owner-typing fails without the oracle", () =>
    expectSetupAloneFails(desktopOwnerTyping),
  )
})
