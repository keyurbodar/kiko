import * as Schema from "effect/Schema"

const Text = Schema.String
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Real = Schema.Number

export const Mode = Schema.Literals(["background", "foreground"])
export type Mode = typeof Mode.Type

export const Grant = Schema.Literals(["granted", "denied", "unknown", "not_needed"])
export type Grant = typeof Grant.Type

export const PermissionKind = Schema.Literals(["accessibility", "screen", "automation", "browser"])
export type PermissionKind = typeof PermissionKind.Type

export const Permissions = Schema.Struct({
  accessibility: Grant,
  screen: Grant,
  automation: Grant,
})
export type Permissions = typeof Permissions.Type

export const BrowserState = Schema.Literals(["connected", "needs_consent", "not_running", "unsupported"])
export type BrowserState = typeof BrowserState.Type

export const BrowserStatus = Schema.Struct({ name: Text, state: BrowserState })
export type BrowserStatus = typeof BrowserStatus.Type

export const Status = Schema.Struct({
  version: Text,
  os: Text,
  session: Text,
  permissions: Permissions,
  browsers: Schema.Array(BrowserStatus),
})
export type Status = typeof Status.Type

export const Rect = Schema.Struct({ x: Real, y: Real, w: Real, h: Real })
export type Rect = typeof Rect.Type

export const Point = Schema.Struct({ x: Real, y: Real })
export type Point = typeof Point.Type

export const Window = Schema.Struct({
  id: Text,
  pid: Count,
  app: Text,
  bundle: Schema.optionalKey(Text),
  title: Text,
  frame: Rect,
  focused: Schema.Boolean,
  minimized: Schema.Boolean,
  on_screen: Schema.Boolean,
})
export type Window = typeof Window.Type

export const ACTIONS = [
  "press",
  "focus",
  "set_value",
  "type",
  "key",
  "scroll",
  "show_menu",
  "select",
  "toggle",
  "expand",
  "collapse",
  "raise",
] as const

export const Action = Schema.Literals(ACTIONS)
export type Action = typeof Action.Type

export const Node = Schema.Struct({
  ref: Count,
  role: Text,
  name: Schema.optionalKey(Text),
  value: Schema.optionalKey(Text),
  frame: Schema.optionalKey(Rect),
  states: Schema.optionalKey(Schema.Array(Text)),
  actions: Schema.optionalKey(Schema.Array(Action)),
  children: Schema.optionalKey(Schema.Array(Count)),
})
export type Node = typeof Node.Type

export const Image = Schema.Struct({
  mime: Text,
  data: Text,
  width: Count,
  height: Count,
  covers: Rect,
})
export type Image = typeof Image.Type

export const Look = Schema.Struct({
  window: Window,
  image: Schema.optionalKey(Image),
  nodes: Schema.Array(Node),
  outline: Text,
})
export type Look = typeof Look.Type

export const Tab = Schema.Struct({
  id: Text,
  browser: Text,
  window_id: Count,
  index: Count,
  active: Schema.Boolean,
  title: Text,
  url: Text,
})
export type Tab = typeof Tab.Type

export const Page = Schema.Struct({
  tab: Tab,
  nodes: Schema.Array(Node),
  outline: Text,
  image: Schema.optionalKey(Image),
})
export type Page = typeof Page.Type

export const Route = Schema.Literals(["accessibility", "window_event", "private", "dom", "trusted", "foreground"])
export type Route = typeof Route.Type

export const ActResult = Schema.Struct({ route: Route })
export type ActResult = typeof ActResult.Type

export const LookParams = Schema.Struct({
  window: Text,
  tree: Schema.optionalKey(Schema.Boolean),
  image: Schema.optionalKey(Schema.Boolean),
  max_width: Schema.optionalKey(Count),
})
export type LookParams = typeof LookParams.Type

export const ActParams = Schema.Struct({
  window: Text,
  ref: Schema.optionalKey(Count),
  point: Schema.optionalKey(Point),
  action: Action,
  text: Schema.optionalKey(Text),
  keys: Schema.optionalKey(Text),
  dx: Schema.optionalKey(Real),
  dy: Schema.optionalKey(Real),
  mode: Schema.optionalKey(Mode),
})
export type ActParams = typeof ActParams.Type

export const OpenParams = Schema.Struct({
  kind: Schema.Literals(["app", "url", "path"]),
  target: Text,
  mode: Schema.optionalKey(Mode),
})
export type OpenParams = typeof OpenParams.Type

export const TabParams = Schema.Struct({ tab: Text })
export type TabParams = typeof TabParams.Type

export const BrowserOpenParams = Schema.Struct({
  url: Text,
  mode: Schema.optionalKey(Mode),
})
export type BrowserOpenParams = typeof BrowserOpenParams.Type

export const BrowserReadParams = Schema.Struct({
  tab: Text,
  image: Schema.optionalKey(Schema.Boolean),
  max_width: Schema.optionalKey(Count),
})
export type BrowserReadParams = typeof BrowserReadParams.Type

export const PAGE_ACTIONS = ["click", "type", "set_value", "select", "press_key", "scroll", "focus"] as const

export const PageAction = Schema.Literals(PAGE_ACTIONS)
export type PageAction = typeof PageAction.Type

export const BrowserActParams = Schema.Struct({
  tab: Text,
  ref: Count,
  action: PageAction,
  text: Schema.optionalKey(Text),
  mode: Schema.optionalKey(Mode),
})
export type BrowserActParams = typeof BrowserActParams.Type

export const BrowserEvalParams = Schema.Struct({ tab: Text, expression: Text })
export type BrowserEvalParams = typeof BrowserEvalParams.Type

export const PermissionParams = Schema.Struct({ kind: PermissionKind })
export type PermissionParams = typeof PermissionParams.Type

export const DriverCall = Schema.Union([
  Schema.Struct({ method: Schema.Literal("status") }),
  Schema.Struct({ method: Schema.Literal("permissions.request"), params: PermissionParams }),
  Schema.Struct({ method: Schema.Literal("windows") }),
  Schema.Struct({ method: Schema.Literal("look"), params: LookParams }),
  Schema.Struct({ method: Schema.Literal("act"), params: ActParams }),
  Schema.Struct({ method: Schema.Literal("open"), params: OpenParams }),
  Schema.Struct({ method: Schema.Literal("browser.tabs") }),
  Schema.Struct({ method: Schema.Literal("browser.open"), params: BrowserOpenParams }),
  Schema.Struct({ method: Schema.Literal("browser.close"), params: TabParams }),
  Schema.Struct({ method: Schema.Literal("browser.show"), params: TabParams }),
  Schema.Struct({ method: Schema.Literal("browser.read"), params: BrowserReadParams }),
  Schema.Struct({ method: Schema.Literal("browser.act"), params: BrowserActParams }),
  Schema.Struct({ method: Schema.Literal("browser.eval"), params: BrowserEvalParams }),
])
export type DriverCall = typeof DriverCall.Type

export const ErrorCode = Schema.Literals([
  "denied",
  "background_unavailable",
  "stale",
  "not_found",
  "timeout",
  "unsupported",
  "failed",
])
export type ErrorCode = typeof ErrorCode.Type

export const DriverError = Schema.Struct({ code: ErrorCode, message: Text })
export type DriverError = typeof DriverError.Type

export const DriverResponse = Schema.Union([
  Schema.Struct({ id: Count, ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({ id: Count, ok: Schema.Literal(false), error: DriverError }),
])
export type DriverResponse = typeof DriverResponse.Type
