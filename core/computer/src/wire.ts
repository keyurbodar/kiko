import * as Schema from "effect/Schema"
import { BrowserStatus, DesktopInfo, Display, DriverCall, Permissions } from "./driver"

export { Display }

export const PROTOCOL = 2
export const OLDEST_PROTOCOL = 1

const Text = Schema.String
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Unit = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))

export const Caps = Schema.Struct({
  shell: Schema.Boolean,
  files: Schema.Boolean,
  desktop: Schema.Boolean,
  live: Schema.Boolean,
  input: Schema.Boolean,
  background: Schema.optionalKey(Schema.Boolean),
  browser: Schema.optionalKey(Schema.Boolean),
  terminal: Schema.optionalKey(Schema.Boolean),
})
export type Caps = typeof Caps.Type

export const Resume = Schema.Struct({
  running: Schema.Array(Id),
  recent: Schema.Array(Id),
})
export type Resume = typeof Resume.Type

export const Hello = Schema.Struct({
  t: Schema.Literal("hello"),
  protocol: Count,
  version: Text,
  os: Schema.Literals(["macos", "linux"]),
  arch: Text,
  host: Text,
  caps: Caps,
  displays: Schema.Array(Display),
  access: Schema.optionalKey(Schema.Struct({ screen: Schema.Boolean, input: Schema.Boolean })),
  driver: Schema.optionalKey(Schema.Struct({ permissions: Permissions, browsers: Schema.Array(BrowserStatus) })),
  desktop: Schema.optionalKey(DesktopInfo),
  note: Schema.optionalKey(Text),
  resume: Schema.optionalKey(Resume),
})
export type Hello = typeof Hello.Type

const TerminalStatus = Schema.Literals(["running", "exited"])
const TerminalInfo = Schema.Struct({
  id: Id,
  name: Text,
  cwd: Text,
  shell: Text,
  cols: Count,
  rows: Count,
  status: TerminalStatus,
  exitCode: Schema.NullOr(Schema.Int),
})
const Cols = Schema.Int.check(Schema.isGreaterThanOrEqualTo(20), Schema.isLessThanOrEqualTo(500))
const Rows = Schema.Int.check(Schema.isGreaterThanOrEqualTo(5), Schema.isLessThanOrEqualTo(200))
const Lines = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(5_000))

const OPS = [
  "shell",
  "read",
  "write",
  "driver",
  "terminal_open",
  "terminal_send",
  "terminal_read",
  "terminal_wait",
  "terminal_resize",
  "terminal_close",
  "terminal_list",
] as const
export type Op = (typeof OPS)[number]

export const TERMINAL_OPS: ReadonlySet<Op> = new Set<Op>([
  "terminal_open",
  "terminal_send",
  "terminal_read",
  "terminal_wait",
  "terminal_resize",
  "terminal_close",
  "terminal_list",
])

export const Calls = {
  shell: {
    args: Schema.Struct({ command: Text, cwd: Schema.optionalKey(Text), timeoutMs: Schema.optionalKey(Count) }),
    value: Schema.Struct({
      exitCode: Schema.NullOr(Schema.Int),
      output: Text,
      truncated: Schema.Boolean,
      timedOut: Schema.Boolean,
    }),
  },
  read: {
    args: Schema.Struct({ path: Text, maxBytes: Schema.optionalKey(Count) }),
    value: Schema.Struct({
      size: Count,
      truncated: Schema.Boolean,
      text: Schema.optionalKey(Text),
      base64: Schema.optionalKey(Text),
    }),
  },
  write: {
    args: Schema.Struct({
      path: Text,
      text: Schema.optionalKey(Text),
      base64: Schema.optionalKey(Text),
      append: Schema.optionalKey(Schema.Boolean),
    }),
    value: Schema.Struct({ size: Count }),
  },
  driver: {
    args: DriverCall,
    value: Schema.Unknown,
  },
  terminal_open: {
    args: Schema.Struct({
      cwd: Schema.optionalKey(Text),
      shell: Schema.optionalKey(Text),
      cols: Schema.optionalKey(Cols),
      rows: Schema.optionalKey(Rows),
      name: Schema.optionalKey(Text),
    }),
    value: TerminalInfo,
  },
  terminal_send: {
    args: Schema.Struct({
      id: Id,
      text: Schema.optionalKey(Text),
      keys: Schema.optionalKey(Schema.Array(Text)),
      until: Schema.optionalKey(Text),
      regex: Schema.optionalKey(Schema.Boolean),
      timeoutMs: Schema.optionalKey(Count),
    }),
    value: Schema.Struct({
      id: Id,
      bytes: Count,
      matched: Schema.optionalKey(Schema.Boolean),
      timedOut: Schema.optionalKey(Schema.Boolean),
      exited: Schema.optionalKey(Schema.Boolean),
      text: Schema.optionalKey(Text),
    }),
  },
  terminal_read: {
    args: Schema.Struct({ id: Id, mode: Schema.Literals(["screen", "tail"]), lines: Schema.optionalKey(Lines) }),
    value: Schema.Struct({
      id: Id,
      mode: Schema.Literals(["screen", "tail"]),
      text: Text,
      truncated: Schema.Boolean,
      cols: Count,
      rows: Count,
      status: TerminalStatus,
      exitCode: Schema.NullOr(Schema.Int),
    }),
  },
  terminal_wait: {
    args: Schema.Struct({
      id: Id,
      until: Text,
      regex: Schema.optionalKey(Schema.Boolean),
      timeoutMs: Schema.optionalKey(Count),
    }),
    value: Schema.Struct({
      id: Id,
      matched: Schema.Boolean,
      timedOut: Schema.Boolean,
      exited: Schema.Boolean,
      text: Text,
    }),
  },
  terminal_resize: {
    args: Schema.Struct({ id: Id, cols: Cols, rows: Rows }),
    value: Schema.Struct({ id: Id, cols: Count, rows: Count }),
  },
  terminal_close: {
    args: Schema.Struct({ id: Id }),
    value: Schema.Struct({ id: Id, closed: Schema.Boolean }),
  },
  terminal_list: {
    args: Schema.Struct({}),
    value: Schema.Struct({ terminals: Schema.Array(TerminalInfo) }),
  },
} as const satisfies Record<Op, { args: Schema.Top; value: Schema.Top }>
export type Args<O extends Op> = (typeof Calls)[O]["args"]["Type"]
export type Value<O extends Op> = (typeof Calls)[O]["value"]["Type"]

export const FailCode = Schema.Literals(["denied", "busy", "stale", "timeout", "unsupported", "cancelled", "failed"])
export type FailCode = typeof FailCode.Type

export const InputEvent = Schema.Union([
  Schema.Struct({ k: Schema.Literal("move"), x: Unit, y: Unit }),
  Schema.Struct({ k: Schema.Literal("down"), x: Unit, y: Unit, b: Count }),
  Schema.Struct({ k: Schema.Literal("up"), x: Unit, y: Unit, b: Count }),
  Schema.Struct({ k: Schema.Literal("wheel"), x: Unit, y: Unit, dx: Schema.Number, dy: Schema.Number }),
  Schema.Struct({ k: Schema.Literal("key"), code: Text, key: Text, down: Schema.Boolean, mods: Count }),
  Schema.Struct({ k: Schema.Literal("text"), s: Text }),
  Schema.Struct({ k: Schema.Literal("cursor"), who: Schema.Literals(["agent", "real"]), x: Unit, y: Unit }),
])
export type InputEvent = typeof InputEvent.Type

export const TerminalStream = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    history: Text,
    cols: Count,
    rows: Count,
    status: TerminalStatus,
    exitCode: Schema.NullOr(Schema.Int),
  }),
  Schema.Struct({ type: Schema.Literal("output"), data: Text }),
  Schema.Struct({ type: Schema.Literal("exit"), code: Schema.NullOr(Schema.Int) }),
  Schema.Struct({ type: Schema.Literal("error"), message: Text }),
])
export type TerminalStream = typeof TerminalStream.Type

export const Holder = Schema.Literals(["agent", "human"])
export type Holder = typeof Holder.Type

export const RtcSignal = Schema.Struct({
  type: Schema.Literals(["offer", "answer", "ice", "bye"]),
  sdp: Schema.optionalKey(Text),
  candidate: Schema.optionalKey(Text),
  mid: Schema.optionalKey(Text),
})
export type RtcSignal = typeof RtcSignal.Type

export const IceServer = Schema.Struct({
  urls: Schema.Union([Text, Schema.Array(Text)]),
  username: Schema.optionalKey(Text),
  credential: Schema.optionalKey(Text),
})
export type IceServer = typeof IceServer.Type

export const ToDaemon = Schema.Union([
  Schema.Struct({ t: Schema.Literal("welcome"), id: Id, name: Text, version: Schema.optionalKey(Text) }),
  Schema.Struct({
    t: Schema.Literal("call"),
    id: Id,
    op: Schema.Literals(OPS),
    args: Schema.Unknown,
    deadlineMs: Count,
  }),
  Schema.Struct({ t: Schema.Literal("cancel"), id: Id }),
  Schema.Struct({
    t: Schema.Literal("live"),
    on: Schema.Boolean,
    fps: Schema.optionalKey(Count),
    maxWidth: Schema.optionalKey(Count),
    quality: Schema.optionalKey(Count),
  }),
  Schema.Struct({
    t: Schema.Literal("control"),
    holder: Holder,
    epoch: Schema.optionalKey(Count),
    session: Schema.optionalKey(Id),
  }),
  Schema.Struct({ t: Schema.Literal("input"), events: Schema.Array(InputEvent) }),
  Schema.Struct({ t: Schema.Literal("ack"), seq: Count }),
  Schema.Struct({
    t: Schema.Literal("rtc"),
    session: Id,
    signal: RtcSignal,
    iceServers: Schema.optionalKey(Schema.Array(IceServer)),
  }),
  Schema.Struct({
    t: Schema.Literal("terminal"),
    on: Schema.Boolean,
    id: Id,
    terminal: Schema.optionalKey(Id),
    cols: Schema.optionalKey(Cols),
    rows: Schema.optionalKey(Rows),
  }),
  Schema.Struct({ t: Schema.Literal("terminalInput"), id: Id, data: Text }),
  Schema.Struct({ t: Schema.Literal("terminalResize"), id: Id, cols: Cols, rows: Rows }),
  Schema.Struct({ t: Schema.Literal("terminalAck"), id: Id, bytes: Count }),
])
export type ToDaemon = typeof ToDaemon.Type

export const FromDaemon = Schema.Union([
  Hello,
  Schema.Struct({
    t: Schema.Literal("result"),
    id: Id,
    ok: Schema.Literal(true),
    value: Schema.Unknown,
    opMs: Schema.optionalKey(Count),
  }),
  Schema.Struct({
    t: Schema.Literal("result"),
    id: Id,
    ok: Schema.Literal(false),
    error: Schema.Struct({ code: FailCode, message: Text }),
    opMs: Schema.optionalKey(Count),
  }),
  Schema.Struct({ t: Schema.Literal("chunk"), id: Id, data: Text }),
  Schema.Struct({ t: Schema.Literal("humanInput") }),
  Schema.Struct({ t: Schema.Literal("held"), holder: Holder, epoch: Schema.optionalKey(Count) }),
  Schema.Struct({ t: Schema.Literal("rtc"), session: Id, signal: RtcSignal }),
  Schema.Struct({ t: Schema.Literal("terminal"), id: Id, event: TerminalStream }),
])
export type FromDaemon = typeof FromDaemon.Type

export const BinaryResult = Schema.Struct({
  t: Schema.Literal("result"),
  id: Id,
  ok: Schema.Literal(true),
  value: Schema.Unknown,
  parts: Schema.Array(Schema.Struct({ mime: Text, length: Count })),
})
export type BinaryResult = typeof BinaryResult.Type
