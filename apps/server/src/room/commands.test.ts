import { assert, describe, it } from "@effect/vitest"
import { MAX_MESSAGE_TEXT, memberRefusalText, type AgentSlug, type MessageId } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import { vi } from "vitest"
import {
  answerRefusal,
  type CommandRoom,
  editRefusal,
  makeRoomCommands,
  memberRefusal,
  reactionRefusal,
  sendRefusal,
} from "./commands"

const slug = "ada" as AgentSlug

function harness(options: { settle?: () => Promise<void>; soon?: (work: Promise<unknown>) => void } = {}) {
  const works: Promise<unknown>[] = []
  const room = {
    log: {
      message: () => null,
      editMessage: () => null,
      deleteMessages: () => null,
      react: () => null,
      markRead: () => null,
    },
    gone: () => false,
    mutateMessage: async <T>(_id: string, apply: () => T) => apply(),
    publish: () => {},
    humanTyping: () => {},
    stop: async () => {},
    search: () => ({}),
    history: async () => [],
    stepWindow: () => [],
    thoughts: async () => [],
    memberOp: () => null,
    memberList: () => [],
    fileOp: () => null,
    humanSend: async () => ({ ack: { id: "m1", seq: 1 }, events: [] }),
    taskOp: () => null,
    setModel: () => {},
    answerAsk: async () => {},
    skipAsk: async () => {},
    retryRun: async () => {},
    settleHumanInput: options.settle ?? (async () => {}),
  } as unknown as CommandRoom
  const soon = options.soon ?? ((work: Promise<unknown>) => void works.push(work))
  return { commands: makeRoomCommands(room, soon), works }
}

describe("room command background settle", () => {
  it("acknowledges a send before the settle finishes", async () => {
    let finish!: () => void
    let finished = false
    const { commands, works } = harness({
      settle: () =>
        new Promise<void>((resolve) => {
          finish = () => {
            finished = true
            resolve()
          }
        }),
    })
    const ack = await Effect.runPromise(commands.send({ clientId: "c1", text: "hi" }))
    assert.deepStrictEqual(ack, { id: "m1", seq: 1 })
    assert.isFalse(finished)
    assert.strictEqual(works.length, 1)
    finish()
    await works[0]
    assert.isTrue(finished)
  })

  it("hands the settle to the background hook", async () => {
    let finish!: () => void
    let done = false
    const settled = new Promise<void>((resolve) => {
      finish = () => {
        done = true
        resolve()
      }
    })
    const works: Promise<unknown>[] = []
    const { commands } = harness({ settle: () => settled, soon: (work) => void works.push(work) })
    await Effect.runPromise(commands.react({ messageId: "m1" as MessageId, emoji: "👍" }))
    assert.strictEqual(works.length, 1)
    const [work] = works
    assert.instanceOf(work, Promise)
    assert.isFalse(done)
    finish()
    await work
    assert.isTrue(done)
  })

  it("logs a rejected settle instead of rejecting the command", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const { commands, works } = harness({
        settle: async () => {
          throw new Error("burst failed")
        },
      })
      const ack = await Effect.runPromise(commands.send({ clientId: "c1", text: "hi" }))
      assert.deepStrictEqual(ack, { id: "m1", seq: 1 })
      await Promise.all(works.map((work) => work.catch(() => void 0)))
      assert.deepStrictEqual(spy.mock.calls, [["settle failed: burst failed"]])
    } finally {
      spy.mockRestore()
    }
  })
})

describe("room command refusals", () => {
  it("refuses an empty send and accepts a short one", () => {
    assert.strictEqual(sendRefusal("   "), "that message is empty")
    assert.strictEqual(sendRefusal("hi"), null)
  })

  it("refuses a send longer than the limit", () => {
    assert.strictEqual(sendRefusal("x".repeat(MAX_MESSAGE_TEXT + 1)), "that message is too long to send")
  })

  it("refuses a blank edit", () => {
    assert.strictEqual(editRefusal(" "), "that edit is too long to save")
    assert.strictEqual(editRefusal("fixed"), null)
  })

  it("refuses a blank answer", () => {
    assert.strictEqual(answerRefusal(""), "that answer is too long to send")
    assert.strictEqual(answerRefusal("yes"), null)
  })

  it("accepts clearing a reaction and refuses whitespace emoji", () => {
    assert.strictEqual(reactionRefusal(null), null)
    assert.strictEqual(reactionRefusal("👍"), null)
    assert.strictEqual(reactionRefusal("a b"), "that reaction is not usable")
  })

  it("needs a name to add a member but not to remove one", () => {
    assert.strictEqual(memberRefusal({ op: "add", slug, name: " " }), "that member needs a name")
    assert.strictEqual(memberRefusal({ op: "remove", slug }), null)
  })

  it("explains a member refusal in the words the app shows", () => {
    assert.strictEqual(memberRefusalText({ op: "add", slug, name: "Ada" }, "exists"), "Ada is already in this chat")
    assert.strictEqual(memberRefusalText({ op: "remove", slug }, "reserved"), "@ada is a reserved handle")
  })
})
