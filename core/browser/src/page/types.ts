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
  scroll?: { y: number; height: number; view: number }
}

export type Step =
  | { op: "click"; id: ControlId }
  | { op: "hover"; id: ControlId }
  | { op: "type"; id: ControlId; text: string; submit?: boolean }
  | { op: "select"; id: ControlId; option: string }
  | { op: "wait"; text?: string; gone?: string; ms?: number; navigation?: boolean; timeoutMs?: number }
  | { op: "press"; key: string }
  | { op: "scroll"; direction: "up" | "down" }
  | { op: "back" }
  | { op: "forward" }
  | { op: "reload" }
  | { op: "goto"; url: string }

type StepFailure = "stale" | "gone" | "hidden" | "dialog" | "timeout" | "crashed"

export type StepResult = { ok: true; note?: string } | { ok: false; reason: StepFailure; detail?: string }

export interface Tab {
  readonly id: string
  read(): Promise<PageView>
  act(step: Step): Promise<StepResult>
  screenshot(opts?: { fullPage?: boolean }): Promise<Uint8Array>
  takeNotes(): string[]
  front(): Promise<void>
  close(): Promise<void>
}

export interface BrowserSession {
  openTab(url?: string): Promise<Tab>
  tab(id: string): Tab | undefined
  attach(id: string): Promise<Tab | undefined>
  listTabs(): Promise<{ id: string; url: string; title: string }[]>
  closed: Promise<void>
  close(): Promise<void>
}
