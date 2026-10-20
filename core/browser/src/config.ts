export const BROWSER = {
  tabsPerBrowser: 8,
  urlsPerBrowse: 4,
  browseMs: 90_000,
  stepsPerAct: 10,
  commandMs: 10_000,
  loadMs: 10_000,
  settleMs: 50,
  menuSettleMs: 200,
  controlsMax: 250,
  textMax: 6_000,
  summaryControls: 40,
} as const

export type BrowserConfig = typeof BROWSER
