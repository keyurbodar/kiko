import * as Schema from "effect/Schema"

export const PROTOCOL = 1

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
})
export type Caps = typeof Caps.Type

export const Display = Schema.Struct({ id: Id, width: Count, height: Count, scale: Schema.Number })
export type Display = typeof Display.Type

export const Hello = Schema.Struct({
  t: Schema.Literal("hello"),
  protocol: Count,
  version: Text,
  os: Schema.Literals(["macos", "linux", "windows"]),
  arch: Text,
  host: Text,
  caps: Caps,
  displays: Schema.Array(Display),
  access: Schema.optionalKey(Schema.Struct({ screen: Schema.Boolean, input: Schema.Boolean })),
  note: Schema.optionalKey(Text),
})
export type Hello = typeof Hello.Type

export const Control = Schema.Struct({
  id: Count,
  role: Text,
  label: Text,
  x: Count,
  y: Count,
  w: Count,
  h: Count,
})
export type Control = typeof Control.Type

export const View = Schema.Struct({
  captureId: Id,
  width: Count,
  height: Count,
  app: Schema.optionalKey(Text),
  title: Schema.optionalKey(Text),
  controls: Schema.Array(Control),
  tree: Schema.optionalKey(Text),
  image: Schema.optionalKey(Schema.Struct({ mime: Schema.Literals(["image/jpeg", "image/png"]), data: Text })),
})
export type View = typeof View.Type

const Point = { id: Schema.optionalKey(Count), x: Schema.optionalKey(Count), y: Schema.optionalKey(Count) }

export const Step = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("click"),
    ...Point,
    button: Schema.optionalKey(Schema.Literals(["left", "right", "middle"])),
    count: Schema.optionalKey(Count),
  }),
  Schema.Struct({ op: Schema.Literal("type"), ...Point, text: Text, submit: Schema.optionalKey(Schema.Boolean) }),
  Schema.Struct({ op: Schema.Literal("key"), keys: Text }),
  Schema.Struct({ op: Schema.Literal("scroll"), ...Point, dx: Schema.Int, dy: Schema.Int }),
  Schema.Struct({ op: Schema.Literal("drag"), from: Schema.Tuple([Count, Count]), to: Schema.Tuple([Count, Count]) }),
  Schema.Struct({ op: Schema.Literal("move"), x: Count, y: Count }),
  Schema.Struct({ op: Schema.Literal("open"), app: Text }),
  Schema.Struct({ op: Schema.Literal("wait"), ms: Count }),
])
export type Step = typeof Step.Type

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
  look: {
    args: Schema.Struct({
      display: Schema.optionalKey(Id),
      controls: Schema.optionalKey(Schema.Boolean),
      image: Schema.optionalKey(Schema.Boolean),
      maxWidth: Schema.optionalKey(Count),
      zoom: Schema.optionalKey(
        Schema.Struct({ captureId: Schema.optionalKey(Id), x: Count, y: Count, width: Count, height: Count }),
      ),
    }),
    value: View,
  },
  act: {
    args: Schema.Struct({
      captureId: Schema.optionalKey(Id),
      steps: Schema.Array(Step),
      image: Schema.optionalKey(Schema.Boolean),
    }),
    value: Schema.Struct({ done: Count, error: Schema.optionalKey(Text), view: View }),
  },
} as const
export type Op = keyof typeof Calls
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
    op: Schema.Literals(["shell", "read", "write", "look", "act"]),
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
  Schema.Struct({ t: Schema.Literal("control"), holder: Holder }),
  Schema.Struct({ t: Schema.Literal("input"), events: Schema.Array(InputEvent) }),
  Schema.Struct({ t: Schema.Literal("ack"), seq: Count }),
  Schema.Struct({
    t: Schema.Literal("rtc"),
    session: Id,
    signal: RtcSignal,
    iceServers: Schema.optionalKey(Schema.Array(IceServer)),
  }),
])
export type ToDaemon = typeof ToDaemon.Type

export const FromDaemon = Schema.Union([
  Hello,
  Schema.Struct({ t: Schema.Literal("result"), id: Id, ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({
    t: Schema.Literal("result"),
    id: Id,
    ok: Schema.Literal(false),
    error: Schema.Struct({ code: FailCode, message: Text }),
  }),
  Schema.Struct({ t: Schema.Literal("chunk"), id: Id, data: Text }),
  Schema.Struct({ t: Schema.Literal("humanInput") }),
  Schema.Struct({ t: Schema.Literal("rtc"), session: Id, signal: RtcSignal }),
])
export type FromDaemon = typeof FromDaemon.Type
