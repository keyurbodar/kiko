export type ControlId = number

export type Control = {
  id: ControlId
  role: string
  label: string
  value?: string
  state?: string
  hint?: string
  href?: string
}

export type PageView = {
  key: string
  url: string
  title: string
  controls: Control[]
  text: string
  omitted: number
}

export type Step =
  | { op: "click"; id: ControlId }
  | { op: "type"; id: ControlId; text: string; submit?: boolean }
  | { op: "select"; id: ControlId; option: string }
  | { op: "press"; key: string }
  | { op: "scroll"; direction: "up" | "down" }
  | { op: "back" }
  | { op: "goto"; url: string }

export type StepFailure = "stale" | "gone" | "hidden" | "dialog" | "timeout" | "crashed"

export type StepResult = { ok: true } | { ok: false; reason: StepFailure; detail?: string }

export type DialogPolicy = (dialog: { type: "alert" | "beforeunload" | "confirm" | "prompt"; message: string }) => "accept" | "stop"

export interface Tab {
  readonly id: string
  read(): Promise<PageView>
  act(step: Step): Promise<StepResult>
  screenshot(): Promise<Uint8Array>
  close(): Promise<void>
}

export interface BrowserSession {
  openTab(url?: string): Promise<Tab>
  tab(id: string): Tab | undefined
  onPopup(listener: (opener: string, tab: Tab) => void): void
  closed: Promise<void>
  close(): Promise<void>
}
