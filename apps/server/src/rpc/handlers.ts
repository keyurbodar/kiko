import type { OwnerRpcs, RoomId } from "@kiko/protocol"
import type * as Effect from "effect/Effect"
import type * as Rpc from "effect/rpc/Rpc"
import type { RoomCommands } from "../room/commands"
import type { User } from "../user/user-do"
import type { Streams } from "./subscriptions"
import type { RequestId } from "./wire"

export interface RpcHost {
  readonly streams: Streams
  user(): User
  room(roomId: RoomId): RoomCommands
  streamEnded?(stream: string): void
}

export type Cx = {
  readonly host: RpcHost
  readonly ws: WebSocket
  readonly socket: WebSocket
  readonly requestId: RequestId
}

type Of<Tag extends OwnerRpcs["_tag"]> = Extract<OwnerRpcs, { readonly _tag: Tag }>
type Handler<R> = (payload: Rpc.Payload<R>, cx: Cx) => Effect.Effect<Rpc.SuccessExit<R>, Rpc.ErrorExit<R>>
export type Handlers = { readonly [Tag in OwnerRpcs["_tag"]]: Handler<Of<Tag>> }

export const HANDLERS: Handlers = {
  "user.subscribe": ({ afterSequence }, { host, ws, requestId }) =>
    host.streams.user(ws, requestId, afterSequence ?? 0),
  "room.subscribe": ({ roomId, afterSequence }, { host, ws, requestId }) =>
    host.streams.room(ws, requestId, roomId, afterSequence ?? 0),

  "room.send": ({ roomId, commandId, ...input }, { host }) => host.room(roomId).send({ clientId: commandId, ...input }),
  "room.edit": ({ roomId, ...input }, { host }) => host.room(roomId).edit(input),
  "room.delete": ({ roomId, ...input }, { host }) => host.room(roomId).delete(input),
  "room.react": ({ roomId, ...input }, { host }) => host.room(roomId).react(input),
  "room.read": ({ roomId, ...input }, { host }) => host.room(roomId).read(input),
  "room.typing": ({ roomId }, { host }) => host.room(roomId).typing(),
  "room.stop": ({ roomId }, { host }) => host.room(roomId).stop(),
  "room.setModel": ({ roomId, ...input }, { host }) => host.room(roomId).setModel(input),
  "room.task": ({ roomId, op }, { host }) => host.room(roomId).task({ op }),
  "room.member": ({ roomId, op }, { host }) => host.room(roomId).member({ op }),
  "room.files": ({ roomId, op }, { host }) => host.room(roomId).files({ op }),
  "room.answer": ({ roomId, ...input }, { host }) => host.room(roomId).answer(input),
  "room.skip": ({ roomId, ...input }, { host }) => host.room(roomId).skip(input),
  "room.retry": ({ roomId, ...input }, { host }) => host.room(roomId).retry(input),
  "room.search": ({ roomId, ...input }, { host }) => host.room(roomId).search(input),
  "room.history": ({ roomId, ...input }, { host }) => host.room(roomId).history(input),
  "room.steps": ({ roomId, ...input }, { host }) => host.room(roomId).steps(input),

  "chat.command": ({ op }, { host }) => host.user().chatCommand(op),
  "chat.open": ({ roomId }, { host }) => host.user().chatOpened(roomId),
  "chat.search": ({ query }, { host }) => host.user().chatSearch(query),
  "search.messages": ({ query, before }, { host }) => host.user().searchMessages(query, before),

  "agent.create": (input, { host }) => host.user().newAgent(input),
  "agent.command": ({ op }, { host }) => host.user().agentCommand(op),
  "agent.setModel": (input, { host }) => host.user().agentSetModel(input),
  "soul.get": ({ slug }, { host }) => host.user().soulGet(slug),
  "soul.update": ({ slug, body, expectSha }, { host }) => host.user().soulUpdate(slug, body, expectSha),

  "memory.run": ({ op }, { host }) => host.user().memoryRun(op),
  "theme.set": ({ theme }, { host }) => host.user().themeSet(theme),
  "settings.get": (_, { host }) => host.user().settingsGet(),
  "settings.update": ({ patch }, { host }) => host.user().settingsUpdate(patch),
  "storage.usage": (_, { host }) => host.user().storageUsage(),
  "models.catalog": (_, { host }) => host.user().catalog(),
  "version.get": (_, { host }) => host.user().version(),
  "files.token": (_, { host }) => host.user().fileToken(),
  "files.writeText": (input, { host }) => host.user().writeText(input),
  "home.files": ({ op }, { host }) => host.user().homeFiles(op),

  "credentials.list": (_, { host }) => host.user().credentialsList(),
  "credentials.connect": ({ provider, apiKey }, { host }) => host.user().credentialsConnect(provider, apiKey),
  "credentials.disconnect": ({ provider }, { host }) => host.user().credentialsDisconnect(provider),
  "credentials.check": ({ provider }, { host }) => host.user().credentialsCheck(provider),
  "login.start": ({ loginId, provider }, { host, socket }) => host.user().loginStart(socket, loginId, provider),
  "login.answer": ({ loginId, promptId, value }, { host, socket }) =>
    host.user().loginAnswer(socket, loginId, promptId, value),
  "login.cancel": ({ loginId }, { host, socket }) => host.user().loginCancel(socket, loginId),

  "composio.connect": ({ apiKey }, { host }) => host.user().composioConnect(apiKey),
  "composio.disconnect": (_, { host }) => host.user().composioDisconnect(),
  "composio.status": ({ tools }, { host }) => host.user().composioStatus(tools),
  "kernel.connect": ({ apiKey }, { host }) => host.user().kernel.kernelConnect(apiKey),
  "kernel.disconnect": (_, { host }) => host.user().kernel.kernelDisconnect(),
  "kernel.status": (_, { host, socket }) => host.user().kernel.kernelStatus(socket),
  "browser.link": ({ mode }, { host }) => host.user().kernel.browserLink(mode),
  "browser.handBack": (_, { host }) => host.user().kernel.browserHandBack(),
  "browser.close": (_, { host }) => host.user().kernel.browserClose(),

  "pc.pairCode": (_, { host, socket }) => host.user().pc.pairCode(socket),
  "pc.remove": ({ pcId }, { host }) => host.user().pc.remove(pcId),
  "pc.rename": ({ pcId, name }, { host }) => host.user().pc.rename(pcId, name),
  "pc.watch": ({ pcId, on, mode }, { host, socket }) => host.user().pc.watch(socket, pcId, on, mode),
  "pc.frames": ({ pcId }, { host, ws, requestId }) => host.user().pc.frames(ws, requestId, pcId),
  "pc.take": ({ pcId }, { host, socket }) => host.user().pc.take(socket, pcId),
  "pc.release": ({ pcId }, { host }) => host.user().pc.release(pcId),
  "pc.rtc": ({ pcId, signal }, { host, socket }) => host.user().pc.rtc(socket, pcId, signal),
  "pc.input": ({ pcId, events }, { host }) => host.user().pc.input(pcId, events),
  "pc.ack": ({ pcId, seq }, { host }) => host.user().pc.ack(pcId, seq),

  "recipes.list": (_, { host }) => host.user().recipesList(),
  "recipes.install": (input, { host }) => host.user().recipesInstall(input),
  "recipes.uninstall": ({ installId }, { host }) => host.user().recipesUninstall(installId),
  "recipes.edit": ({ slug }, { host }) => host.user().recipesEdit(slug),
  "routines.update": ({ id, status }, { host }) => host.user().routineStatus(id, status),
  "routines.cancel": ({ id }, { host }) => host.user().routineCancel(id),
}
