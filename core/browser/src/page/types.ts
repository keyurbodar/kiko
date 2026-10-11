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
  | { op: "hover"; id: ControlId }
  | { op: "type"; id: ControlId; text: string; submit?: boolean }
  | { op: "select"; id: ControlId; option: string }
  | { op: "upload"; id: ControlId; paths: string[] }
  | { op: "wait"; text?: string; gone?: string; ms?: number; navigation?: boolean; timeoutMs?: number }
  | { op: "press"; key: string }
  | { op: "scroll"; direction: "up" | "down" }
  | { op: "back" }
  | { op: "goto"; url: string }

type StepFailure = "stale" | "gone" | "hidden" | "dialog" | "timeout" | "crashed"

export type StepResult = { ok: true } | { ok: false; reason: StepFailure; detail?: string }

export type Dialog = { type: "alert" | "beforeunload" | "confirm" | "prompt"; message: string }

export type DialogPolicy = (dialog: Dialog) => "accept" | "stop"

export type ExtractKind = "links" | "tables" | "forms" | "headings" | "all_text"

export type EvalResult = { ok: true; value: string } | { ok: false; error: string }

export interface Tab {
  readonly id: string
  read(): Promise<PageView>
  act(step: Step): Promise<StepResult>
  eval(expression: string): Promise<EvalResult>
  extract(kind: ExtractKind): Promise<string>
  screenshot(opts?: { fullPage?: boolean }): Promise<Uint8Array>
  dialog(): Dialog | null
  answerDialog(accept: boolean, text?: string): Promise<boolean>
  url(): Promise<string>
  title(): Promise<string>
  close(): Promise<void>
}

export interface BrowserSession {
  openTab(url?: string): Promise<Tab>
  tab(id: string): Tab | undefined
  listTabs(): Promise<{ id: string; url: string; title: string }[]>
  onPopup(listener: (opener: string, tab: Tab) => void): void
  closed: Promise<void>
  close(): Promise<void>
}
