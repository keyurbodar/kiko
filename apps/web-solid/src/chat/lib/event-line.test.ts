import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../lib/types";
import { eventRow, threadLabel } from "./event-line";

const row = (event: unknown, extra: Partial<ChatMessage> = {}) =>
  eventRow({ id: "m", threadId: "t", sender: "bot", body: "", sentAt: 0, event, ...extra } as ChatMessage, (slug) => slug.toUpperCase());

describe("the row of a divider", () => {
  test.each([
    [{ kind: "routine_created", agent: "kiko", title: "Morning summary", byAgent: true, private: true }, { label: "KIKO created a routine", detail: "Morning summary" }],
    [{ kind: "routine_created", agent: "kiko", title: "Morning summary", private: true }, { label: "Routine added", detail: "Morning summary" }],
    [{ kind: "compacted", agent: "ada", private: true }, { label: "Context compacted" }],
    [{ kind: "compacted", agent: "ada", tokensBefore: 12400, tokensAfter: 3100, private: true }, { label: "Context compacted", detail: "12,400 to 3,100 tokens" }],
    [{ kind: "group_formed", private: true }, { label: "Group formed" }],
    [{ kind: "member_added", slug: "bob", name: "Bob", private: true }, { label: "Bob joined" }],
    [{ kind: "member_removed", slug: "bob", name: "Bob", private: true }, { label: "Bob left" }],
    [{ kind: "created", roomId: "r", title: "Sunny morning" }, { label: "Sunny morning is ready" }],
    [{ kind: "agent_message", from: "kiko", to: "ada" }, { label: "KIKO messaged ADA" }],
    [{ kind: "delegated", from: "kiko", to: "ada", title: "write the tests" }, { label: "KIKO asked ADA", detail: "write the tests" }],
    [{ kind: "worker", agent: "ada", state: "started", title: "find prices", private: true }, { label: "ADA started a task", detail: "find prices" }],
    [{ kind: "worker", agent: "ada", state: "done", title: "find prices", private: true }, { label: "ADA finished a task", detail: "find prices" }],
    [{ kind: "worker", agent: "ada", state: "failed", title: "find prices", private: true }, { label: "ADA could not finish a task", detail: "find prices", tone: "danger" as const }],
    [{ kind: "run_stopped", agent: "ada", private: true }, { label: "Stopped", detail: "ADA" }],
  ])("%j", (event, want) => {
    expect(row(event)).toEqual(want);
  });

  test("a model switch is a context handoff, whichever fields the event carries", () => {
    expect(row({ kind: "model_changed", agent: "ada", from: "Claude Opus 4.6", to: "Cat Jam Free", private: true })).toEqual({ label: "Context handoff", detail: "Claude Opus 4.6 to Cat Jam Free" });
    expect(row({ kind: "model_changed", agent: "ada", previous: "A", model: "B", private: true })).toEqual({ label: "Context handoff", detail: "A to B" });
    expect(row({ kind: "model_changed", agent: "ada", model: "Claude Opus 4.6", private: true })).toEqual({ label: "Context handoff", detail: "Claude Opus 4.6" });
  });

  test("a failed run is a danger row with the server's short reason and the provider's words in the title", () => {
    const event = { kind: "run_error", slug: "ada", reason: "quota", actions: ["change_model"], detail: "insufficient_quota", private: true };
    expect(row(event, { body: "OpenAI: quota or credit used up" })).toEqual({
      label: "ADA could not answer",
      tone: "danger",
      detail: "OpenAI: quota or credit used up",
      title: "OpenAI: quota or credit used up\ninsufficient_quota",
    });
  });

  test("a kind from a newer server has no row", () => {
    expect(row({ kind: "from_a_newer_server" })).toBeNull();
    expect(row({ kind: "worker", agent: "kiko", state: "from_a_newer_server", title: "x", private: true })).toBeNull();
  });
});

describe("the label of a folded agent thread", () => {
  test("one message names who messaged whom, more count the exchange", () => {
    expect(threadLabel(["Kiko", "Ada"], 1)).toBe("Kiko messaged Ada");
    expect(threadLabel(["Kiko", "Ada"], 3)).toBe("Kiko and Ada exchanged 3 messages");
    expect(threadLabel(["Kiko", "Ada", "Bob"], 1)).toBe("Kiko, Ada and Bob exchanged 1 message");
  });
});
