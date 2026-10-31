import * as Schema from "effect/Schema"
import { Count, Id, stored } from "./base"
import { Actor, Sender } from "./envelope"
import { NoticeError } from "./errors"
import { AgentSlug, MessageId, RoomId } from "./brands"
import { RichText } from "./rich-text-codec"

export const AgentState = Schema.Literals(["idle", "typing", "working"])
export type AgentState = typeof AgentState.Type

export const ToolKind = Schema.Literals(["read", "edit", "search", "run", "web", "other"])
export type ToolKind = typeof ToolKind.Type

export const WorkerRow = Schema.Struct({
  id: Id,
  task: Schema.String,
  status: Schema.Literals(["pending", "running", "done", "failed", "stopped"]),
  step: Schema.NullOr(Schema.String),
  steps: Count,
  startedAt: Count,
})
export type WorkerRow = typeof WorkerRow.Type

export const Activity = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("writing") }),
  Schema.Struct({ kind: Schema.Literal("tool"), tool: ToolKind, caption: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("failed"), caption: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("background"), workers: Schema.Array(WorkerRow) }),
])
export type Activity = typeof Activity.Type

export const AgentStatus = Schema.Struct({
  slug: AgentSlug,
  state: AgentState,
  doing: Schema.optionalKey(Schema.String),
  activity: Schema.optionalKey(Activity),
})
export type AgentStatus = typeof AgentStatus.Type

export const RunStepStatus = Schema.Literals(["running", "done", "failed"])
export type RunStepStatus = typeof RunStepStatus.Type

export const RunStep = Schema.Struct({
  id: Id,
  runId: Id,
  slug: AgentSlug,
  tool: ToolKind,
  name: Schema.String,
  app: Schema.optionalKey(Schema.String),
  worker: Schema.optionalKey(Schema.Struct({ id: Id, task: Schema.String })),
  note: Schema.optionalKey(Schema.Literal(true)),
  label: Schema.String,
  input: Schema.optionalKey(Schema.String),
  status: RunStepStatus,
  startedAt: Count,
  endedAt: Schema.optionalKey(Count),
  output: Schema.optionalKey(Schema.String),
  after: Count,
})
export type RunStep = typeof RunStep.Type

export const ThoughtPart = Schema.Struct({
  part: Count,
  text: Schema.String,
  startedAt: Count,
  spentMs: Count,
})
export type ThoughtPart = typeof ThoughtPart.Type

export const RunErrorKind = Schema.Literals([
  "no_key",
  "signed_out",
  "no_model",
  "invalid_key",
  "quota",
  "rate_limit",
  "model_not_found",
  "network",
  "overloaded",
  "timeout",
  "cut_off",
  "refused",
  "too_long",
  "other",
])
export type RunErrorKind = typeof RunErrorKind.Type

export const RunErrorAction = Schema.Literals(["retry", "change_model", "open_settings"])
export type RunErrorAction = typeof RunErrorAction.Type

const privately = { private: Schema.Literal(true) }

export const SystemEvent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("created"), roomId: RoomId, title: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("delegated"), from: AgentSlug, to: AgentSlug, title: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("routine"), title: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("agent_message"), from: AgentSlug, to: AgentSlug }),
  Schema.Struct({
    kind: Schema.Literal("routine_created"),
    agent: AgentSlug,
    title: Schema.String,
    byAgent: Schema.optionalKey(Schema.Literal(true)),
    ...privately,
  }),
  Schema.Struct({
    kind: Schema.Literal("model_changed"),
    agent: AgentSlug,
    model: Schema.String,
    from: Schema.optionalKey(Schema.String),
    ...privately,
  }),
  Schema.Struct({ kind: Schema.Literal("compacted"), agent: AgentSlug, ...privately }),
  Schema.Struct({ kind: Schema.Literal("activity"), agent: AgentSlug, ...privately }),
  Schema.Struct({ kind: Schema.Literal("run_stopped"), agent: AgentSlug, ...privately }),
  Schema.Struct({ kind: Schema.Literal("group_formed"), ...privately }),
  Schema.Struct({ kind: Schema.Literal("member_added"), slug: AgentSlug, name: Schema.String, ...privately }),
  Schema.Struct({ kind: Schema.Literal("member_removed"), slug: AgentSlug, name: Schema.String, ...privately }),
  Schema.Struct({ kind: Schema.Literal("browser_control"), agent: AgentSlug, reason: Schema.String, ...privately }),
  Schema.Struct({
    kind: Schema.Literal("computer_control"),
    agent: AgentSlug,
    pc: Schema.String,
    reason: Schema.String,
    ...privately,
  }),
  Schema.Struct({
    kind: Schema.Literal("run_error"),
    slug: AgentSlug,
    reason: RunErrorKind,
    actions: Schema.Array(RunErrorAction),
    provider: Schema.optionalKey(Schema.String),
    detail: Schema.optionalKey(Schema.String),
    ...privately,
  }),
])
export type SystemEvent = typeof SystemEvent.Type

export const UnknownSystemEvent = Schema.Struct({ kind: Schema.String })
export type UnknownSystemEvent = typeof UnknownSystemEvent.Type

export const HumanQuestion = Schema.Struct({
  id: Id,
  header: Schema.String,
  question: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      description: Schema.optionalKey(Schema.String),
      value: Schema.optionalKey(Schema.String),
    }),
  ),
  multiSelect: Schema.optionalKey(Schema.Boolean),
  allowCustomAnswer: Schema.optionalKey(Schema.Boolean),
})
export type HumanQuestion = typeof HumanQuestion.Type

export const HumanAnswers = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Array(Schema.String)]))
export type HumanAnswers = typeof HumanAnswers.Type

export const HumanAsk = Schema.Struct({
  id: Id,
  from: AgentSlug,
  text: Schema.String,
  options: Schema.optionalKey(Schema.Array(Schema.String)),
  questions: Schema.optionalKey(Schema.Array(HumanQuestion)),
  messageId: MessageId,
})
export type HumanAsk = typeof HumanAsk.Type

export const FileRef = Schema.Struct({ id: Id, name: Schema.String, size: Count, type: Schema.String })
export type FileRef = typeof FileRef.Type

export const OwnerFile = Schema.Struct({
  roomId: Schema.NullOr(RoomId),
  file: FileRef,
  madeBy: Schema.NullOr(AgentSlug),
  at: Count,
})
export type OwnerFile = typeof OwnerFile.Type

export const PendingAttachment = Schema.Struct({
  pendingId: Id,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  type: Schema.String.check(Schema.isMaxLength(255)),
  size: Count,
})
export type PendingAttachment = typeof PendingAttachment.Type

export const Reaction = Schema.Struct({ by: Actor, emoji: Schema.String })
export type Reaction = typeof Reaction.Type

export const RunRef = Schema.Struct({ runId: Id, attempt: Count, index: Count })
export type RunRef = typeof RunRef.Type

export const ReplyPreview = Schema.Struct({
  seq: Count,
  from: Actor,
  text: Schema.String,
  gone: Schema.optionalKey(Schema.Literal(true)),
})
export type ReplyPreview = typeof ReplyPreview.Type

export const Message = Schema.Struct({
  id: MessageId,
  clientId: Schema.optionalKey(Schema.String),
  ...stored,
  from: Sender,
  text: Schema.String,
  rich: Schema.optionalKey(RichText),
  replyTo: Schema.optionalKey(MessageId),
  reply: Schema.optionalKey(ReplyPreview),
  files: Schema.optionalKey(Schema.Array(FileRef)),
  run: Schema.optionalKey(RunRef),
  editedAt: Schema.optionalKey(Count),
  reactions: Schema.optionalKey(Schema.Array(Reaction)),
  goto: Schema.optionalKey(RoomId),
  quote: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.Union([AgentSlug, Schema.Literal("all")])),
  initiative: Schema.optionalKey(Schema.Struct({ reason: Schema.String })),
  event: Schema.optionalKey(Schema.Union([SystemEvent, UnknownSystemEvent])),
  steps: Schema.optionalKey(Count),
  stepAfter: Schema.optionalKey(Count),
})
export type Message = typeof Message.Type

export const Member = Schema.Struct({
  slug: AgentSlug,
  name: Schema.String,
  lead: Schema.Boolean,
  role: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
})
export type Member = typeof Member.Type

export const MemberOp = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("add"),
    slug: AgentSlug,
    name: Schema.String,
    role: Schema.optionalKey(Schema.String),
    model: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ op: Schema.Literal("remove"), slug: AgentSlug }),
  Schema.Struct({ op: Schema.Literal("rename"), slug: AgentSlug, name: Schema.String }),
])
export type MemberOp = typeof MemberOp.Type

const FilePath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))

export const FileOp = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("rm"),
    paths: Schema.Array(FilePath).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    recursive: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({ op: Schema.Literal("mv"), from: FilePath, to: FilePath }),
  Schema.Struct({ op: Schema.Literal("mkdir"), path: FilePath }),
])
export type FileOp = typeof FileOp.Type

export const MemberRefusal = Schema.Literals(["limit", "exists", "unknown", "last", "reserved", "chief", "kiko"])
export type MemberRefusal = typeof MemberRefusal.Type

export const MAX_MEMBERS = 8

export function memberRefusalText(op: MemberOp, reason: MemberRefusal): string {
  const who = "name" in op ? op.name : op.slug
  switch (reason) {
    case "limit":
      return `A group holds at most ${MAX_MEMBERS} agents`
    case "exists":
      return `${who} is already in this chat`
    case "unknown":
      return `${who} is not in this chat`
    case "last":
      return "A chat keeps at least one agent"
    case "reserved":
      return `@${op.slug} is a reserved handle`
    case "chief":
      return "Kiko leads every chat and stays in it"
    case "kiko":
      return "The Kiko chat stays with Kiko. Start a new group instead"
  }
}

export const TaskStatus = Schema.Literals(["todo", "doing", "blocked", "review", "done", "cancelled"])
export type TaskStatus = typeof TaskStatus.Type

export const Task = Schema.Struct({
  id: Id,
  title: Schema.String,
  status: TaskStatus,
  owner: Schema.optionalKey(AgentSlug),
  dependsOn: Schema.Array(Id),
  note: Schema.optionalKey(Schema.String),
})
export type Task = typeof Task.Type

export const TaskOp = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("create"),
    id: Id,
    title: Schema.String,
    owner: Schema.optionalKey(AgentSlug),
    dependsOn: Schema.optionalKey(Schema.Array(Id)),
  }),
  Schema.Struct({
    op: Schema.Literal("update"),
    id: Id,
    title: Schema.optionalKey(Schema.String),
    status: Schema.optionalKey(TaskStatus),
    owner: Schema.optionalKey(Schema.NullOr(AgentSlug)),
    note: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ op: Schema.Literal("delete"), id: Id }),
])
export type TaskOp = typeof TaskOp.Type

export const RoomEvent = Schema.Union([
  Schema.Struct({ t: Schema.Literal("message"), ...Message.fields }),
  Schema.Struct({
    ...stored,
    t: Schema.Literal("edit"),
    messageId: MessageId,
    text: Schema.String,
    rich: Schema.optionalKey(RichText),
  }),
  Schema.Struct({ ...stored, t: Schema.Literal("delete"), messageIds: Schema.Array(MessageId) }),
  Schema.Struct({
    ...stored,
    t: Schema.Literal("react"),
    messageId: MessageId,
    by: Actor,
    emoji: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ ...stored, t: Schema.Literal("read"), upTo: Count }),
  Schema.Struct({ ...stored, t: Schema.Literal("member"), member: Member }),
  Schema.Struct({ ...stored, t: Schema.Literal("member_removed"), slug: AgentSlug }),
  Schema.Struct({ ...stored, t: Schema.Literal("task"), task: Task }),
  Schema.Struct({ ...stored, t: Schema.Literal("task_removed"), id: Id }),
  Schema.Struct({ ...stored, t: Schema.Literal("file"), file: FileRef }),
  Schema.Struct({ ...stored, t: Schema.Literal("file_removed"), ids: Schema.Array(Id) }),
  Schema.Struct({ ...stored, t: Schema.Literal("folders"), folders: Schema.Array(Schema.String) }),
  Schema.Struct({ ...stored, t: Schema.Literal("ask"), ...HumanAsk.fields }),
  Schema.Struct({
    ...stored,
    t: Schema.Literal("ask_resolved"),
    id: Id,
    how: Schema.Literals(["answered", "skipped"]),
  }),
])
export type RoomEvent = typeof RoomEvent.Type

export const RoomSnapshot = Schema.Struct({
  seq: Count,
  readSeq: Count,
  members: Schema.Array(Member),
  messages: Schema.Array(Message),
  tasks: Schema.Array(Task),
  files: Schema.Array(FileRef),
  folders: Schema.Array(Schema.String),
  agents: Schema.optionalKey(Schema.Array(AgentStatus)),
  asks: Schema.optionalKey(Schema.Array(HumanAsk)),
})
export type RoomSnapshot = typeof RoomSnapshot.Type

export const SearchHit = Schema.Struct({ id: MessageId, seq: Count, at: Count, from: Sender, snippet: Schema.String })
export type SearchHit = typeof SearchHit.Type

export const ChatSearchHit = Schema.Struct({ ...SearchHit.fields, roomId: RoomId })
export type ChatSearchHit = typeof ChatSearchHit.Type

export const ChatSearchPage = Schema.Struct({
  results: Schema.Array(ChatSearchHit),
  next: Schema.NullOr(Count),
  partial: Schema.Boolean,
})
export type ChatSearchPage = typeof ChatSearchPage.Type

export const RoomSearchPage = Schema.Struct({ results: Schema.Array(SearchHit), next: Schema.NullOr(Count) })
export type RoomSearchPage = typeof RoomSearchPage.Type

export const Hello = Schema.Struct({ t: Schema.Literal("hello"), lastSeq: Count })

export const ClientToRoom = Schema.Union([
  Hello,
  Schema.Struct({
    t: Schema.Literal("send"),
    clientId: Id,
    text: Schema.String,
    replyTo: Schema.optionalKey(MessageId),
    quote: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1000))),
    attachments: Schema.optionalKey(Schema.Array(PendingAttachment)),
  }),
  Schema.Struct({ t: Schema.Literal("react"), messageId: MessageId, emoji: Schema.NullOr(Schema.String) }),
  Schema.Struct({ t: Schema.Literal("edit"), messageId: MessageId, text: Schema.String }),
  Schema.Struct({ t: Schema.Literal("delete"), messageId: MessageId }),
  Schema.Struct({ t: Schema.Literal("read"), seq: Count }),
  Schema.Struct({ t: Schema.Literal("typing") }),
  Schema.Struct({ t: Schema.Literal("stop") }),
  Schema.Struct({ t: Schema.Literal("model"), ref: Schema.String, slug: Schema.optionalKey(AgentSlug) }),
  Schema.Struct({ t: Schema.Literal("task"), op: TaskOp }),
  Schema.Struct({ t: Schema.Literal("member"), op: MemberOp }),
  Schema.Struct({ t: Schema.Literal("files"), op: FileOp }),
  Schema.Struct({
    t: Schema.Literal("search"),
    query: Schema.String,
    before: Schema.optionalKey(Count),
    limit: Schema.optionalKey(Count),
  }),
  Schema.Struct({ t: Schema.Literal("history"), seq: Count, before: Count, after: Count }),
  Schema.Struct({ t: Schema.Literal("answer"), id: Id, value: Schema.Union([Schema.String, HumanAnswers]) }),
  Schema.Struct({ t: Schema.Literal("skip"), id: Id }),
  Schema.Struct({ t: Schema.Literal("retry"), messageId: MessageId }),
  Schema.Struct({ t: Schema.Literal("steps"), slug: AgentSlug, after: Count }),
])
export type ClientToRoom = typeof ClientToRoom.Type

export const RoomSignal = Schema.Union([
  Schema.Struct({ t: Schema.Literal("typing"), who: Schema.Array(AgentSlug) }),
  Schema.Struct({
    t: Schema.Literal("thinking"),
    slug: AgentSlug,
    runId: Id,
    part: Count,
    offset: Count,
    text: Schema.String,
    startedAt: Count,
    done: Schema.Boolean,
  }),
  Schema.Struct({ t: Schema.Literal("status"), ...AgentStatus.fields }),
  Schema.Struct({ t: Schema.Literal("step"), step: RunStep }),
  Schema.Struct({ t: Schema.Literal("error"), error: NoticeError }),
])
export type RoomSignal = typeof RoomSignal.Type

export const RoomToClient = Schema.Union([
  Schema.Struct({ t: Schema.Literal("events"), events: Schema.Array(RoomEvent) }),
  Schema.Struct({ t: Schema.Literal("ack"), clientId: Id, id: MessageId, seq: Count }),
  Schema.Struct({ t: Schema.Literal("reset"), snapshot: RoomSnapshot }),
  Schema.Struct({ t: Schema.Literal("steps"), slug: AgentSlug, after: Count, steps: Schema.Array(RunStep) }),
  Schema.Struct({ t: Schema.Literal("member_refused"), op: MemberOp, reason: MemberRefusal }),
  Schema.Struct({ t: Schema.Literal("send_refused"), clientId: Id, reason: Schema.String }),
  Schema.Struct({ t: Schema.Literal("task_refused"), op: TaskOp, reason: Schema.String }),
  Schema.Struct({ t: Schema.Literal("files_refused"), op: FileOp, reason: Schema.String }),
  Schema.Struct({
    t: Schema.Literal("search"),
    query: Schema.String,
    before: Schema.optionalKey(Count),
    ...RoomSearchPage.fields,
  }),
  Schema.Struct({
    t: Schema.Literal("history"),
    seq: Count,
    before: Count,
    after: Count,
    messages: Schema.Array(Message),
  }),
  ...RoomSignal.members,
])
export type RoomToClient = typeof RoomToClient.Type
