import * as Schema from "effect/Schema"
import { Count, Id, stored } from "./base"
import { NoticeError } from "./errors"
import { AgentSlug, RoomId } from "./brands"
import { MemoryOp, MemoryResult } from "./memory"
import { FileOp, FileRef, Hello } from "./room"
import { ThinkingLevel } from "./catalog"
import { ProviderInfo } from "./providers"
import { Trigger } from "./routines"
import { ROW_KINDS } from "./rows"

export const LastKind = Schema.Literals([
  "text",
  "photo",
  "video",
  "album",
  "file",
  "voice",
  "audio",
  "link",
  "react",
  "joined",
  "left",
  "renamed",
  "created",
  "notice",
])
export type LastKind = typeof LastKind.Type

export const ChatLast = Schema.Struct({
  from: Schema.Literals(["human", "agent", "system"]),
  name: Schema.optionalKey(Schema.String),
  kind: LastKind,
  text: Schema.optionalKey(Schema.String),
  file: Schema.optionalKey(Schema.String),
  count: Schema.optionalKey(Count),
  emoji: Schema.optionalKey(Schema.String),
  at: Count,
})
export type ChatLast = typeof ChatLast.Type

export const RoutineRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  roomId: RoomId,
  status: Schema.Literals(["active", "paused"]),
  trigger: Trigger,
  tz: Schema.String,
})
export type RoutineRow = typeof RoutineRow.Type

export const SoulRow = Schema.Struct({ id: AgentSlug, body: Schema.String, sha: Schema.String, at: Count })
export type SoulRow = typeof SoulRow.Type

export const ProviderRow = Schema.Struct({ id: Schema.String, ...ProviderInfo.fields })
export type ProviderRow = typeof ProviderRow.Type

export const RowKind = Schema.Literals(ROW_KINDS)
export type RowKind = typeof RowKind.Type

export const RowLists = Schema.Struct({
  routine: Schema.optionalKey(Schema.Array(RoutineRow)),
  soul: Schema.optionalKey(Schema.Array(SoulRow)),
  provider: Schema.optionalKey(Schema.Array(ProviderRow)),
})
export type RowLists = typeof RowLists.Type

export const Chat = Schema.Struct({
  roomId: RoomId,
  title: Schema.String,
  pinned: Schema.Boolean,
  muted: Schema.Boolean,
  lastSeq: Count,
  lastPreview: Schema.String,
  unread: Count,
  updatedAt: Count,
  agents: Schema.optionalKey(Schema.Array(Schema.String)),
  kiko: Schema.optionalKey(Schema.Literal(true)),
  private: Schema.optionalKey(Schema.Boolean),
  last: Schema.optionalKey(ChatLast),
  mentions: Schema.optionalKey(Count),
  group: Schema.optionalKey(Schema.Literal(true)),
  pair: Schema.optionalKey(Schema.Literal(true)),
})
export type Chat = typeof Chat.Type

export const Agent = Schema.Struct({
  id: Id,
  name: Schema.String,
  slug: AgentSlug,
  prompt: Schema.String,
  model: Schema.String,
})
export type Agent = typeof Agent.Type

export const AgentModel = Schema.Struct({
  model: Schema.String,
  name: Schema.optionalKey(Schema.String),
  thinking: ThinkingLevel,
  thinkingLevels: Schema.Array(ThinkingLevel),
})
export type AgentModel = typeof AgentModel.Type

export const AgentOp = Schema.Union([
  Schema.Struct({ op: Schema.Literal("create"), agent: Agent }),
  Schema.Struct({ op: Schema.Literal("delete"), slug: AgentSlug }),
])
export type AgentOp = typeof AgentOp.Type

export const ChatOp = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("create"),
    roomId: RoomId,
    title: Schema.String,
    agents: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.Struct({ op: Schema.Literal("rename"), roomId: RoomId, title: Schema.String }),
  Schema.Struct({ op: Schema.Literal("pin"), roomId: RoomId, pinned: Schema.Boolean }),
  Schema.Struct({ op: Schema.Literal("mute"), roomId: RoomId, muted: Schema.Boolean }),
  Schema.Struct({ op: Schema.Literal("private"), roomId: RoomId, private: Schema.Boolean }),
  Schema.Struct({ op: Schema.Literal("delete"), roomId: RoomId }),
])
export type ChatOp = typeof ChatOp.Type

export const UserEvent = Schema.Union([
  Schema.Struct({
    ...stored,
    t: Schema.Literal("chat"),
    chat: Chat,
    projection: Schema.optionalKey(Schema.Literal(true)),
  }),
  Schema.Struct({ ...stored, t: Schema.Literal("chat_removed"), roomId: RoomId }),
  Schema.Struct({ ...stored, t: Schema.Literal("agent"), agent: Agent }),
  Schema.Struct({ ...stored, t: Schema.Literal("agent_removed"), id: Schema.String, slug: AgentSlug }),
  Schema.Struct({ ...stored, t: Schema.Literal("agent_model"), slug: AgentSlug, ...AgentModel.fields }),
  Schema.Struct({ ...stored, t: Schema.Literal("theme"), theme: Schema.NullOr(Schema.String) }),
  Schema.Struct({ ...stored, t: Schema.Literal("file"), file: FileRef }),
  Schema.Struct({ ...stored, t: Schema.Literal("file_removed"), ids: Schema.Array(Id) }),
  Schema.Struct({ ...stored, t: Schema.Literal("folders"), folders: Schema.Array(Schema.String) }),
  Schema.Struct({ ...stored, t: Schema.Literal("row"), kind: Schema.Literal("routine"), row: RoutineRow }),
  Schema.Struct({ ...stored, t: Schema.Literal("row"), kind: Schema.Literal("soul"), row: SoulRow }),
  Schema.Struct({ ...stored, t: Schema.Literal("row"), kind: Schema.Literal("provider"), row: ProviderRow }),
  Schema.Struct({ ...stored, t: Schema.Literal("row_removed"), kind: RowKind, id: Schema.String }),
])
export type UserEvent = typeof UserEvent.Type

export const UserSnapshot = Schema.Struct({
  seq: Count,
  chats: Schema.Array(Chat),
  agents: Schema.optionalKey(Schema.Array(Agent)),
  agentModels: Schema.optionalKey(Schema.Record(Schema.String, AgentModel)),
  theme: Schema.optionalKey(Schema.NullOr(Schema.String)),
  home: Schema.Struct({ files: Schema.Array(FileRef), folders: Schema.Array(Schema.String) }),
  rows: Schema.optionalKey(RowLists),
  lastChat: Schema.optionalKey(RoomId),
})
export type UserSnapshot = typeof UserSnapshot.Type

export const ComposioStatus = Schema.Struct({ connected: Schema.Boolean, rows: Schema.Number })
export type ComposioStatus = typeof ComposioStatus.Type

export const ComposioResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    status: ComposioStatus,
    tools: Schema.optionalKey(Schema.Array(Schema.String)),
    readOnly: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])
export type ComposioResult = typeof ComposioResult.Type

const BrowserMode = Schema.Literals(["headless", "headful"])

export const KernelStatus = Schema.Struct({
  connected: Schema.Boolean,
  broken: Schema.Boolean,
  browser: Schema.NullOr(Schema.Struct({ mode: BrowserMode, tabs: Schema.Record(Schema.String, Schema.Number) })),
})
export type KernelStatus = typeof KernelStatus.Type

export const KernelResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), status: KernelStatus }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])
export type KernelResult = typeof KernelResult.Type

export const WebApp = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  owned: Schema.Boolean,
  expiresAt: Schema.NullOr(Schema.String),
})
export type WebApp = typeof WebApp.Type

export const LakebedAccount = Schema.Union([
  Schema.Struct({ state: Schema.Literal("connected"), login: Schema.NullOr(Schema.String) }),
  Schema.Struct({ state: Schema.Literal("waiting"), url: Schema.String, code: Schema.String }),
  Schema.Struct({ state: Schema.Literal("none") }),
])
export type LakebedAccount = typeof LakebedAccount.Type

export const WebAppsResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    available: Schema.Boolean,
    account: LakebedAccount,
    apps: Schema.Array(WebApp),
  }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])
export type WebAppsResult = typeof WebAppsResult.Type

export const ClaimResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), url: Schema.String, code: Schema.String }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])
export type ClaimResult = typeof ClaimResult.Type

export const BrowserState = Schema.NullOr(
  Schema.Struct({
    mode: BrowserMode,
    tabs: Schema.Array(Schema.Struct({ agent: Schema.String, slug: Schema.String, host: Schema.String })),
    takeover: Schema.Boolean,
    switching: Schema.Boolean,
    since: Count,
  }),
)
export type BrowserState = typeof BrowserState.Type

export const BrowserLinkResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), url: Schema.String }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
])
export type BrowserLinkResult = typeof BrowserLinkResult.Type

export const ComputerId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
const Unit = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))

export const ComputerCaps = Schema.Struct({
  shell: Schema.Boolean,
  files: Schema.Boolean,
  desktop: Schema.Boolean,
  live: Schema.Boolean,
  input: Schema.Boolean,
  background: Schema.optionalKey(Schema.Boolean),
  browser: Schema.optionalKey(Schema.Boolean),
})
export type ComputerCaps = typeof ComputerCaps.Type

export const ComputerBrowser = Schema.Struct({
  name: Schema.String,
  state: Schema.Literals(["connected", "needs_consent", "not_running", "unsupported"]),
})
export type ComputerBrowser = typeof ComputerBrowser.Type

export const ComputerDisplay = Schema.Struct({ id: Id, width: Count, height: Count, scale: Schema.Number })
export type ComputerDisplay = typeof ComputerDisplay.Type

export const ComputerSignal = Schema.Struct({
  type: Schema.Literals(["offer", "answer", "ice", "bye"]),
  sdp: Schema.optionalKey(Schema.String),
  candidate: Schema.optionalKey(Schema.String),
  mid: Schema.optionalKey(Schema.String),
})
export type ComputerSignal = typeof ComputerSignal.Type

export const ComputerIceServer = Schema.Struct({
  urls: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  username: Schema.optionalKey(Schema.String),
  credential: Schema.optionalKey(Schema.String),
})
export type ComputerIceServer = typeof ComputerIceServer.Type

export const ComputerInput = Schema.Union([
  Schema.Struct({ k: Schema.Literal("move"), x: Unit, y: Unit }),
  Schema.Struct({ k: Schema.Literal("down"), x: Unit, y: Unit, b: Count }),
  Schema.Struct({ k: Schema.Literal("up"), x: Unit, y: Unit, b: Count }),
  Schema.Struct({ k: Schema.Literal("wheel"), x: Unit, y: Unit, dx: Schema.Number, dy: Schema.Number }),
  Schema.Struct({
    k: Schema.Literal("key"),
    code: Schema.String,
    key: Schema.String,
    down: Schema.Boolean,
    mods: Count,
  }),
  Schema.Struct({ k: Schema.Literal("text"), s: Schema.String }),
  Schema.Struct({ k: Schema.Literal("cursor"), who: Schema.Literals(["agent", "real"]), x: Unit, y: Unit }),
])
export type ComputerInput = typeof ComputerInput.Type

export const ComputerAgent = Schema.Struct({
  slug: AgentSlug,
  roomId: RoomId,
  reason: Schema.optionalKey(Schema.String),
})
export type ComputerAgent = typeof ComputerAgent.Type

export const ComputerSummary = Schema.Struct({
  id: ComputerId,
  name: Schema.String,
  os: Schema.Literals(["macos", "linux", "windows"]),
  online: Schema.Boolean,
  caps: ComputerCaps,
  holder: Schema.Literals(["agent", "human"]),
  heldBy: Schema.optionalKey(Schema.Literals(["you", "other"])),
  busy: Schema.optionalKey(Schema.Boolean),
  agent: Schema.optionalKey(ComputerAgent),
  displays: Schema.Array(ComputerDisplay),
  access: Schema.optionalKey(Schema.Struct({ screen: Schema.Boolean, input: Schema.Boolean })),
  background: Schema.Boolean,
  browsers: Schema.Array(ComputerBrowser),
  note: Schema.optionalKey(Schema.String),
})
export type ComputerSummary = typeof ComputerSummary.Type

export const ComputerFrame = Schema.Struct({
  seq: Count,
  mime: Schema.Literals(["image/jpeg", "image/webp"]),
  width: Count,
  height: Count,
  cursor: Schema.NullOr(Schema.Struct({ x: Unit, y: Unit })),
  data: Schema.String,
})
export type ComputerFrame = typeof ComputerFrame.Type

export const ReleaseVersion = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,64}$/))

export const ClientToUser = Schema.Union([
  Hello,
  Schema.Struct({ t: Schema.Literal("home"), op: FileOp }),
  Schema.Struct({ t: Schema.Literal("chat"), op: ChatOp }),
  Schema.Struct({ t: Schema.Literal("open"), roomId: RoomId }),
  Schema.Struct({ t: Schema.Literal("agent"), op: AgentOp }),
  Schema.Struct({
    t: Schema.Literal("agent_model"),
    slug: AgentSlug,
    ref: Schema.optionalKey(Schema.String),
    thinking: Schema.optionalKey(ThinkingLevel),
    roomId: Schema.optionalKey(RoomId),
  }),
  Schema.Struct({ t: Schema.Literal("memory"), reqId: Id, op: MemoryOp }),
  Schema.Struct({ t: Schema.Literal("theme"), theme: Schema.NullOr(Schema.String) }),
  Schema.Struct({ t: Schema.Literal("search"), query: Schema.String }),
  Schema.Struct({ t: Schema.Literal("connectComposio"), reqId: Id, apiKey: Schema.String }),
  Schema.Struct({ t: Schema.Literal("disconnectComposio"), reqId: Id }),
  Schema.Struct({ t: Schema.Literal("composioStatus"), reqId: Id, tools: Schema.optionalKey(Schema.Boolean) }),
  Schema.Struct({ t: Schema.Literal("connectKernel"), reqId: Id, apiKey: Schema.String }),
  Schema.Struct({ t: Schema.Literal("disconnectKernel"), reqId: Id }),
  Schema.Struct({ t: Schema.Literal("kernelStatus"), reqId: Id }),
  Schema.Struct({ t: Schema.Literal("browserLink"), reqId: Id, mode: Schema.Literals(["watch", "control"]) }),
  Schema.Struct({ t: Schema.Literal("handBack") }),
  Schema.Struct({ t: Schema.Literal("closeBrowser") }),
  Schema.Struct({ t: Schema.Literal("pc.pairCode"), reqId: Id }),
  Schema.Struct({ t: Schema.Literal("pc.remove"), reqId: Id, pcId: ComputerId }),
  Schema.Struct({ t: Schema.Literal("pc.rename"), reqId: Id, pcId: ComputerId, name: Schema.String }),
  Schema.Struct({
    t: Schema.Literal("pc.watch"),
    pcId: ComputerId,
    on: Schema.Boolean,
    mode: Schema.optionalKey(Schema.Literals(["rtc", "relay"])),
  }),
  Schema.Struct({ t: Schema.Literal("pc.take"), pcId: ComputerId }),
  Schema.Struct({ t: Schema.Literal("pc.release"), pcId: ComputerId }),
  Schema.Struct({ t: Schema.Literal("pc.rtc"), pcId: ComputerId, signal: ComputerSignal }),
  Schema.Struct({ t: Schema.Literal("pc.input"), pcId: ComputerId, events: Schema.Array(ComputerInput) }),
  Schema.Struct({ t: Schema.Literal("pc.ack"), pcId: ComputerId, seq: Count }),
  Schema.Struct({ t: Schema.Literal("login.start"), loginId: Id, provider: Id }),
  Schema.Struct({ t: Schema.Literal("login.answer"), loginId: Id, promptId: Id, value: Schema.String }),
  Schema.Struct({ t: Schema.Literal("login.cancel"), loginId: Id }),
])
export type ClientToUser = typeof ClientToUser.Type

export const UserChange = Schema.Literals(["memory", "models", "recipes"])
export type UserChange = typeof UserChange.Type

export const LoginEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("info"),
    message: Schema.String,
    links: Schema.optionalKey(
      Schema.Array(Schema.Struct({ url: Schema.String, label: Schema.optionalKey(Schema.String) })),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("auth_url"),
    url: Schema.String,
    instructions: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("device_code"),
    userCode: Schema.String,
    verificationUri: Schema.String,
    intervalSeconds: Schema.optionalKey(Schema.Number),
    expiresInSeconds: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({ type: Schema.Literal("progress"), message: Schema.String }),
])
export type LoginEvent = typeof LoginEvent.Type

export const LoginPrompt = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(["text", "secret", "manual_code"]),
    message: Schema.String,
    placeholder: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("select"),
    message: Schema.String,
    options: Schema.Array(
      Schema.Struct({ id: Schema.String, label: Schema.String, description: Schema.optionalKey(Schema.String) }),
    ),
  }),
])
export type LoginPrompt = typeof LoginPrompt.Type

export const LoginErrorReason = Schema.Literals([
  "unsupported",
  "disabled",
  "unknown",
  "cancelled",
  "timeout",
  "failed",
])
export type LoginErrorReason = typeof LoginErrorReason.Type

export const LoginProvider = Schema.Struct({
  provider: Id,
  kind: Schema.Literals(["api_key", "oauth"]),
  last4: Schema.String,
})
export type LoginProvider = typeof LoginProvider.Type

const handshake = {
  version: Schema.optionalKey(Schema.String),
  protocol: Schema.optionalKey(Schema.Number),
  fileToken: Schema.optionalKey(Schema.String),
}

export const UserSignal = Schema.Union([
  Schema.Struct({ t: Schema.Literal("composio"), reqId: Schema.optionalKey(Id), result: ComposioResult }),
  Schema.Struct({ t: Schema.Literal("kernel"), reqId: Schema.optionalKey(Id), result: KernelResult }),
  Schema.Struct({ t: Schema.Literal("browserState"), state: BrowserState }),
  Schema.Struct({ t: Schema.Literal("pcState"), computers: Schema.Array(ComputerSummary) }),
  Schema.Struct({
    t: Schema.Literal("pc.rtc"),
    pcId: ComputerId,
    signal: ComputerSignal,
    iceServers: Schema.optionalKey(Schema.Array(ComputerIceServer)),
  }),
  Schema.Struct({ t: Schema.Literal("login.notify"), loginId: Id, event: LoginEvent }),
  Schema.Struct({ t: Schema.Literal("login.prompt"), loginId: Id, promptId: Id, prompt: LoginPrompt }),
  Schema.Struct({ t: Schema.Literal("login.done"), loginId: Id, provider: LoginProvider }),
  Schema.Struct({ t: Schema.Literal("login.error"), loginId: Id, reason: LoginErrorReason, message: Schema.String }),
  Schema.Struct({ t: Schema.Literal("error"), error: NoticeError, roomId: Schema.optionalKey(RoomId) }),
  Schema.Struct({ t: Schema.Literal("typing"), roomId: RoomId, names: Schema.Array(Schema.String) }),
  Schema.Struct({ t: Schema.Literal("changed"), what: UserChange }),
])
export type UserSignal = typeof UserSignal.Type

export const UserToClient = Schema.Union([
  Schema.Struct({ t: Schema.Literal("events"), events: Schema.Array(UserEvent), ...handshake }),
  Schema.Struct({ t: Schema.Literal("reset"), snapshot: UserSnapshot, ...handshake }),
  Schema.Struct({ t: Schema.Literal("memory_result"), reqId: Id, result: MemoryResult }),
  Schema.Struct({ t: Schema.Literal("search"), query: Schema.String, chats: Schema.Array(Chat) }),
  Schema.Struct({ t: Schema.Literal("browserLink"), reqId: Id, result: BrowserLinkResult }),
  Schema.Struct({
    t: Schema.Literal("pc.pairCode"),
    reqId: Id,
    code: Schema.String,
    url: Schema.String,
    expiresAt: Count,
  }),
  Schema.Struct({
    t: Schema.Literal("pc.result"),
    reqId: Id,
    ok: Schema.Boolean,
    error: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ t: Schema.Literal("chat_refused"), roomId: RoomId, existing: RoomId }),
  Schema.Struct({ t: Schema.Literal("model_refused"), slug: AgentSlug, message: Schema.String }),
  Schema.Struct({ t: Schema.Literal("home_refused"), op: FileOp, reason: Schema.String }),
  ...UserSignal.members,
])
export type UserToClient = typeof UserToClient.Type

export const INITIATIVE_LEVELS = ["off", "chat", "digest", "active"] as const
const CAPTURE_MODES = ["auto", "off"] as const

export const UserSettings = Schema.Struct({
  initiative: Schema.Literals(INITIATIVE_LEVELS),
  capture: Schema.Literals(CAPTURE_MODES),
  timezone: Schema.optionalKey(Schema.String),
  onboarded: Schema.optionalKey(Schema.Boolean),
})
export type UserSettings = typeof UserSettings.Type

export const UserSettingsPatch = Schema.Struct({
  initiative: Schema.optionalKey(Schema.Literals(INITIATIVE_LEVELS)),
  capture: Schema.optionalKey(Schema.Literals(CAPTURE_MODES)),
  timezone: Schema.optionalKey(Schema.String),
  onboarded: Schema.optionalKey(Schema.Literal(true)),
})
export type UserSettingsPatch = typeof UserSettingsPatch.Type
