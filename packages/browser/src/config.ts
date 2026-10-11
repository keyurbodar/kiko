// Every number the browser obeys. Tune here, nowhere else.
export const BROWSER = {
  tabsPerBrowser: 8,
  workersPerRun: 4,
  urlsPerBrowse: 4,
  stepsPerWorker: 30,
  stepsPerAct: 10,
  unchangedLimit: 3,
  commandMs: 10_000,
  loadMs: 10_000,
  settleMs: 50,
  menuSettleMs: 200,
  controlsMax: 250,
  textMax: 6_000,
  candidates: 35,
  navKept: 10,
  summaryControls: 40,
  summaryText: 1_500,
  passagesPerRank: 20,
  confidenceFloor: 0.6,
  historyForDecision: 3,
  /** Most steps one decision may chain: fills and ticks, then one final step, read once at the end. */
  chainMax: 3,
  /** Where Chrome saves downloads. Set on the browser at connect so the save location is known. */
  downloadDir: "/tmp/kiko-downloads",
  /** How long a confirm or prompt may wait for an answer before it is dismissed. */
  dialogHoldMs: 30_000,
} as const

export type BrowserConfig = typeof BROWSER
