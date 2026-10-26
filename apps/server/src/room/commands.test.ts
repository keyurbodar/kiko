import { assert, describe, it } from "@effect/vitest"
import { MAX_MESSAGE_TEXT, type AgentSlug } from "@kiko/protocol"
import { answerRefusal, editRefusal, memberRefusal, memberRefusalText, reactionRefusal, sendRefusal } from "./commands"

const slug = "ada" as AgentSlug

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
