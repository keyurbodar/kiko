import { assert, describe, it } from "@effect/vitest"
import { type AgentSlug, CommandId, newRoomId, type UserSnapshot } from "@kiko/protocol"
import { Effect, Schema, SubscriptionRef } from "effect"
import { connect, signIn } from "./owner"
import { localWorker } from "./worker"

const commandId = () => Schema.decodeSync(CommandId)(crypto.randomUUID())

const snapshotOf = (items: readonly { kind: string }[]) =>
  (items.find((item) => item.kind === "snapshot") as { snapshot: UserSnapshot } | undefined)?.snapshot

describe("deleting an agent", () => {
  it.live("removes it from the team, its chats and its groups for every fresh client", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "deletion")
      const session = yield* connect(worker.url, owner.token)
      const slug = "motion" as AgentSlug
      const id = crypto.randomUUID()
      yield* session.client["agent.create"]({
        commandId: commandId(),
        id,
        roomId: newRoomId(),
        name: "Motion",
        handle: slug,
        description: "animates things",
      })
      const group = newRoomId()
      yield* session.client["chat.command"]({
        commandId: commandId(),
        op: { op: "create", roomId: group, title: "studio", agents: ["kiko", id] },
      })
      const room = yield* session.openRoom(group)
      yield* room.send("hello studio")
      yield* session.client["agent.command"]({ commandId: commandId(), op: { op: "delete", slug } })

      const fresh = yield* connect(worker.url, owner.token)
      const snapshot = snapshotOf(yield* SubscriptionRef.get(fresh.user))
      assert.isDefined(snapshot, "fresh snapshot")
      const team: string[] = (snapshot?.agents ?? []).map((agent) => agent.slug)
      assert.notInclude(team, slug, "team list")
      for (const chat of snapshot?.chats ?? []) assert.notInclude(chat.agents ?? [], id, `chat ${chat.title}`)
    }).pipe(Effect.scoped),
  )
})

describe("deleting an agent's own chat", () => {
  it.live("deletes the agent too", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "delete-own-chat")
      const session = yield* connect(worker.url, owner.token)
      const slug = "atelier" as AgentSlug
      const roomId = newRoomId()
      yield* session.client["agent.create"]({
        commandId: commandId(),
        id: crypto.randomUUID(),
        roomId,
        name: "Atelier",
        handle: slug,
        description: "designs things",
      })
      yield* session.client["chat.command"]({ commandId: commandId(), op: { op: "delete", roomId } })

      const snapshot = snapshotOf(yield* SubscriptionRef.get((yield* connect(worker.url, owner.token)).user))
      const team: string[] = (snapshot?.agents ?? []).map((agent) => agent.slug)
      assert.notInclude(team, slug, "team list")
      assert.notInclude(
        (snapshot?.chats ?? []).map((chat) => chat.roomId),
        roomId,
        "chat list",
      )
    }).pipe(Effect.scoped),
  )
})

describe("a group named after its members", () => {
  it.live("drops a deleted member from its name", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "group-title")
      const session = yield* connect(worker.url, owner.token)
      const make = (name: string) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          yield* session.client["agent.create"]({
            commandId: commandId(),
            id,
            roomId: newRoomId(),
            name,
            handle: name.toLowerCase() as AgentSlug,
            description: `${name} helps`,
          })
          return id
        })
      const forge = yield* make("Forge")
      const atelier = yield* make("Atelier")
      const group = newRoomId()
      yield* session.client["chat.command"]({
        commandId: commandId(),
        op: { op: "create", roomId: group, title: "Kiko, Forge, Atelier", agents: ["kiko", forge, atelier] },
      })
      yield* session.openRoom(group)
      yield* session.client["agent.command"]({
        commandId: commandId(),
        op: { op: "delete", slug: "forge" as AgentSlug },
      })

      const snapshot = snapshotOf(yield* SubscriptionRef.get((yield* connect(worker.url, owner.token)).user))
      const chat = snapshot?.chats.find((c) => c.roomId === group)
      assert.strictEqual(chat?.title, "Kiko, Atelier")
    }).pipe(Effect.scoped),
  )
})

describe("reopening a chat while an agent works", () => {
  it.live("sends the running steps to a client that resumes from its cached sequence", () =>
    Effect.gen(function* () {
      const worker = yield* localWorker
      const owner = yield* signIn(worker.url, "resume-steps")
      const session = yield* connect(worker.url, owner.token)
      const room = yield* session.newRoom("resume steps")
      yield* owner.post("api/dev/agent/fake", { roomId: room.roomId })
      yield* room.send("[tool] resume probe")
      yield* room.untilSignal((signal) => signal.t === "step" && signal.step.status === "running")
      const seq = (yield* room.messages()).at(-1)?.seq ?? 0
      assert.isAbove(seq, 0)

      const resumed = yield* (yield* connect(worker.url, owner.token)).openRoom(room.roomId, seq)
      const steps = (yield* resumed.signals()).filter((signal) => signal.t === "step")
      assert.isNotEmpty(steps, "running steps on resume")
    }).pipe(Effect.scoped),
  )
})
