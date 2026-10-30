import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as Schema from "effect/Schema"
import { Count, Id } from "./base"
import { Catalog, CustomApi } from "./catalog"
import { ConflictError, IntegrationError, NotFoundError, ProtocolError, RefusedError, StorageError } from "./errors"
import { AgentSlug, CommandId, MessageId, RoomId } from "./brands"
import { MemoryOp, MemoryResult } from "./memory"
import { ProviderInfo } from "./providers"
import { InstallRecipe, RecipeInstall, RecipeList, RecipeNeedsConnect } from "./recipes"
import {
  ChatSearchPage,
  FileOp,
  FileRef,
  HumanAnswers,
  Member,
  MemberOp,
  Message,
  OwnerFile,
  PendingAttachment,
  RoomEvent,
  RoomSignal,
  RoomSearchPage,
  RoomSnapshot,
  RunStep,
  TaskOp,
  ThoughtPart,
} from "./room"
import { SoulRow } from "./user"
import { ThinkingLevel } from "./catalog"
import {
  AgentOp,
  BrowserLinkResult,
  Chat,
  ChatOp,
  ComposioResult,
  ComputerFrame,
  ComputerId,
  ComputerInput,
  ComputerSignal,
  ClaimResult,
  KernelResult,
  UserEvent,
  UserSettings,
  UserSettingsPatch,
  UserSnapshot,
  UserSignal,
  WebAppsResult,
} from "./user"

export class DuplicateChatError extends Schema.TaggedError<DuplicateChatError>()("DuplicateChatError", {
  roomId: RoomId,
  existing: RoomId,
  message: Schema.String,
}) {}

export class FileConflictError extends Schema.TaggedError<FileConflictError>()("FileConflictError", {
  theirs: Schema.NullOr(FileRef),
  message: Schema.String,
}) {}

const Base = Schema.Union([ProtocolError, StorageError])
const Lookup = Schema.Union([ProtocolError, StorageError, NotFoundError])
const Refusable = Schema.Union([ProtocolError, StorageError, NotFoundError, RefusedError])
const Integration = Schema.Union([ProtocolError, StorageError, IntegrationError])

const command = { commandId: CommandId }
const inRoom = { roomId: RoomId }
const roomCommand = { ...command, ...inRoom }

const synchronized = Schema.Struct({ kind: Schema.Literal("synchronized") })

export const UserStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: UserSnapshot,
    version: Schema.optionalKey(Schema.String),
    protocol: Schema.optionalKey(Schema.Number),
    fileToken: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("session"),
    version: Schema.optionalKey(Schema.String),
    protocol: Schema.optionalKey(Schema.Number),
    fileToken: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("event"), sequence: Count, event: UserEvent }),
  Schema.Struct({ kind: Schema.Literal("signal"), signal: UserSignal }),
  synchronized,
])
export type UserStreamItem = typeof UserStreamItem.Type

export const RoomStreamItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: RoomSnapshot }),
  Schema.Struct({ kind: Schema.Literal("event"), sequence: Count, event: RoomEvent }),
  Schema.Struct({ kind: Schema.Literal("signal"), signal: RoomSignal }),
  synchronized,
])
export type RoomStreamItem = typeof RoomStreamItem.Type

export const StorageUsage = Schema.Struct({ objectBytes: Schema.Number, archiveEnabled: Schema.Boolean })
export type StorageUsage = typeof StorageUsage.Type

export const BackendBuild = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  protocol: Schema.optionalKey(Schema.Number),
  storage: Schema.optionalKey(Schema.Literals(["r2", "built-in"])),
})
export type BackendBuild = typeof BackendBuild.Type

export const OWNER_RPC_PATH = "/api/rpc"

export const OwnerRpcs = RpcGroup.make(
  Rpc.make("user.subscribe", {
    payload: { afterSequence: Schema.optionalKey(Count) },
    success: UserStreamItem,
    error: Base,
    stream: true,
  }),
  Rpc.make("room.subscribe", {
    payload: { ...inRoom, afterSequence: Schema.optionalKey(Count) },
    success: RoomStreamItem,
    error: Lookup,
    stream: true,
  }),

  Rpc.make("room.send", {
    payload: {
      ...roomCommand,
      text: Schema.String,
      replyTo: Schema.optionalKey(MessageId),
      quote: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1000))),
      attachments: Schema.optionalKey(Schema.Array(PendingAttachment)),
    },
    success: Schema.Struct({ id: MessageId, seq: Count }),
    error: Refusable,
  }),
  Rpc.make("room.edit", { payload: { ...roomCommand, messageId: MessageId, text: Schema.String }, error: Refusable }),
  Rpc.make("room.delete", { payload: { ...roomCommand, messageId: MessageId }, error: Refusable }),
  Rpc.make("room.react", {
    payload: { ...roomCommand, messageId: MessageId, emoji: Schema.NullOr(Schema.String) },
    error: Refusable,
  }),
  Rpc.make("room.read", { payload: { ...inRoom, seq: Count }, error: Lookup }),
  Rpc.make("room.typing", { payload: inRoom, error: Lookup }),
  Rpc.make("room.stop", { payload: roomCommand, error: Lookup }),
  Rpc.make("room.setModel", {
    payload: { ...roomCommand, ref: Schema.String, slug: Schema.optionalKey(AgentSlug) },
    error: Refusable,
  }),
  Rpc.make("room.task", { payload: { ...roomCommand, op: TaskOp }, error: Refusable }),
  Rpc.make("room.member", {
    payload: { ...roomCommand, op: MemberOp },
    success: Schema.Array(Member),
    error: Refusable,
  }),
  Rpc.make("room.files", { payload: { ...roomCommand, op: FileOp }, error: Refusable }),
  Rpc.make("room.answer", {
    payload: { ...roomCommand, askId: Id, value: Schema.Union([Schema.String, HumanAnswers]) },
    error: Refusable,
  }),
  Rpc.make("room.skip", { payload: { ...roomCommand, askId: Id }, error: Refusable }),
  Rpc.make("room.retry", { payload: { ...roomCommand, messageId: MessageId }, error: Refusable }),
  Rpc.make("room.search", {
    payload: { ...inRoom, query: Schema.String, before: Schema.optionalKey(Count), limit: Schema.optionalKey(Count) },
    success: RoomSearchPage,
    error: Lookup,
  }),
  Rpc.make("room.history", {
    payload: { ...inRoom, seq: Count, before: Count, after: Count },
    success: Schema.Array(Message),
    error: Lookup,
  }),
  Rpc.make("room.steps", {
    payload: { ...inRoom, slug: AgentSlug, after: Count },
    success: Schema.Array(RunStep),
    error: Lookup,
  }),
  Rpc.make("room.thoughts", {
    payload: { ...inRoom, slug: AgentSlug, runId: Id },
    success: Schema.Array(ThoughtPart),
    error: Lookup,
  }),

  Rpc.make("chat.command", {
    payload: { ...command, op: ChatOp },
    error: Schema.Union([ProtocolError, StorageError, NotFoundError, DuplicateChatError]),
  }),
  Rpc.make("chat.open", { payload: inRoom, error: Lookup }),
  Rpc.make("chat.search", { payload: { query: Schema.String }, success: Schema.Array(Chat), error: Base }),
  Rpc.make("search.messages", {
    payload: { query: Schema.String, before: Schema.optionalKey(Count) },
    success: ChatSearchPage,
    error: Base,
  }),

  Rpc.make("agent.create", {
    payload: {
      ...command,
      id: Id,
      roomId: RoomId,
      name: Schema.String,
      handle: AgentSlug,
      description: Schema.String,
    },
    error: Refusable,
  }),
  Rpc.make("agent.command", { payload: { ...command, op: AgentOp }, error: Refusable }),
  Rpc.make("agent.setModel", {
    payload: {
      ...command,
      slug: AgentSlug,
      ref: Schema.optionalKey(Schema.String),
      thinking: Schema.optionalKey(ThinkingLevel),
      roomId: Schema.optionalKey(RoomId),
    },
    error: Refusable,
  }),
  Rpc.make("soul.get", { payload: { slug: AgentSlug }, success: SoulRow, error: Lookup }),
  Rpc.make("soul.update", {
    payload: { ...command, slug: AgentSlug, body: Schema.String, expectSha: Schema.String },
    success: SoulRow,
    error: Schema.Union([ProtocolError, StorageError, NotFoundError, ConflictError]),
  }),

  Rpc.make("memory.run", { payload: { op: MemoryOp }, success: MemoryResult, error: Base }),
  Rpc.make("theme.set", { payload: { ...command, theme: Schema.NullOr(Schema.String) }, error: Base }),
  Rpc.make("settings.get", { success: UserSettings, error: Base }),
  Rpc.make("settings.update", {
    payload: { ...command, patch: UserSettingsPatch },
    success: UserSettings,
    error: Base,
  }),
  Rpc.make("storage.usage", { success: StorageUsage, error: Base }),
  Rpc.make("models.catalog", { success: Catalog, error: Base }),
  Rpc.make("version.get", { success: BackendBuild, error: Base }),
  Rpc.make("files.token", { success: Schema.Struct({ fileToken: Schema.String }), error: Base }),
  Rpc.make("files.writeText", {
    payload: {
      ...command,
      roomId: RoomId,
      path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
      type: Schema.String,
      text: Schema.String,
      expectSha: Schema.String,
    },
    success: FileRef,
    error: Schema.Union([ProtocolError, StorageError, NotFoundError, FileConflictError]),
  }),
  Rpc.make("files.all", { success: Schema.Array(OwnerFile), error: Base }),
  Rpc.make("home.files", { payload: { ...command, op: FileOp }, error: Refusable }),

  Rpc.make("credentials.list", { success: Schema.Array(ProviderInfo), error: Base }),
  Rpc.make("credentials.connect", {
    payload: { ...command, provider: Id, apiKey: Schema.String },
    success: ProviderInfo,
    error: Refusable,
  }),
  Rpc.make("credentials.addCustom", {
    payload: {
      ...command,
      name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
      api: CustomApi,
      baseUrl: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
      apiKey: Schema.String,
    },
    success: ProviderInfo,
    error: Refusable,
  }),
  Rpc.make("credentials.disconnect", { payload: { ...command, provider: Id }, error: Lookup }),
  Rpc.make("credentials.check", { payload: { provider: Id }, success: ProviderInfo, error: Lookup }),
  Rpc.make("login.start", { payload: { loginId: Id, provider: Id }, error: Refusable }),
  Rpc.make("login.answer", { payload: { loginId: Id, promptId: Id, value: Schema.String }, error: Lookup }),
  Rpc.make("login.cancel", { payload: { loginId: Id }, error: Base }),

  Rpc.make("composio.connect", {
    payload: { ...command, apiKey: Schema.String },
    success: ComposioResult,
    error: Integration,
  }),
  Rpc.make("composio.disconnect", { payload: command, success: ComposioResult, error: Integration }),
  Rpc.make("composio.status", {
    payload: { tools: Schema.optionalKey(Schema.Boolean) },
    success: ComposioResult,
    error: Integration,
  }),
  Rpc.make("kernel.connect", {
    payload: { ...command, apiKey: Schema.String },
    success: KernelResult,
    error: Integration,
  }),
  Rpc.make("kernel.disconnect", { payload: command, success: KernelResult, error: Integration }),
  Rpc.make("kernel.status", { success: KernelResult, error: Integration }),
  Rpc.make("webapps.status", { payload: {}, success: WebAppsResult, error: Base }),
  Rpc.make("webapps.connect", { payload: command, success: WebAppsResult, error: Base }),
  Rpc.make("webapps.disconnect", { payload: command, success: WebAppsResult, error: Base }),
  Rpc.make("webapps.claim", { payload: { ...command, name: Schema.String }, success: ClaimResult, error: Base }),
  Rpc.make("browser.link", {
    payload: { mode: Schema.Literals(["watch", "control"]) },
    success: BrowserLinkResult,
    error: Integration,
  }),
  Rpc.make("browser.handBack", { error: Integration }),
  Rpc.make("browser.close", { error: Integration }),

  Rpc.make("pc.pairCode", {
    success: Schema.Struct({ code: Schema.String, url: Schema.String, expiresAt: Count }),
    error: Refusable,
  }),
  Rpc.make("pc.remove", { payload: { ...command, pcId: ComputerId }, error: Refusable }),
  Rpc.make("pc.rename", { payload: { ...command, pcId: ComputerId, name: Schema.String }, error: Refusable }),
  Rpc.make("pc.watch", {
    payload: { pcId: ComputerId, on: Schema.Boolean, mode: Schema.optionalKey(Schema.Literals(["rtc", "relay"])) },
    error: Lookup,
  }),
  Rpc.make("pc.frames", {
    payload: { pcId: ComputerId },
    success: ComputerFrame,
    error: Lookup,
    stream: true,
  }),
  Rpc.make("pc.take", { payload: { pcId: ComputerId }, error: Refusable }),
  Rpc.make("pc.release", { payload: { pcId: ComputerId }, error: Lookup }),
  Rpc.make("pc.rtc", { payload: { pcId: ComputerId, signal: ComputerSignal }, error: Lookup }),
  Rpc.make("pc.input", { payload: { pcId: ComputerId, events: Schema.Array(ComputerInput) }, error: Lookup }),
  Rpc.make("pc.ack", { payload: { pcId: ComputerId, seq: Count }, error: Lookup }),

  Rpc.make("recipes.list", { success: RecipeList, error: Base }),
  Rpc.make("recipes.install", {
    payload: InstallRecipe,
    success: Schema.Union([Schema.Struct({ install: RecipeInstall }), RecipeNeedsConnect]),
    error: Refusable,
  }),
  Rpc.make("recipes.uninstall", { payload: { installId: Id }, error: Base }),
  Rpc.make("recipes.edit", { payload: { slug: Id }, success: Schema.Struct({ path: Schema.String }), error: Lookup }),
  Rpc.make("routines.update", {
    payload: { ...command, id: Id, status: Schema.Literals(["active", "paused"]) },
    error: Lookup,
  }),
  Rpc.make("routines.cancel", { payload: { ...command, id: Id }, error: Lookup }),
)
export type OwnerRpcs = RpcGroup.Rpcs<typeof OwnerRpcs>
