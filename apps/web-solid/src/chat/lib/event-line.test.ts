import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../lib/types";
import { eventText, threadLabel } from "./event-line";

const line = (event: unknown, extra: Partial<ChatMessage> = {}) =>
  eventText({ id: "m", threadId: "t", sender: "bot", body: "", sentAt: 0, event, ...extra } as ChatMessage, (slug) => slug.toUpperCase());

describe("the text of a divider", () => {
  test.each([
    [{ kind: "routine_created", agent: "kiko", title: "Morning summary", private: true }, "KIKO created a routine: Morning summary"],
    [{ kind: "model_changed", agent: "ada", model: "Claude Opus 4.6", private: true }, "ADA now uses Claude Opus 4.6"],
    [{ kind: "compacted", agent: "ada", private: true }, "ADA compacted its context"],
    [{ kind: "member_added", slug: "bob", name: "Bob", private: true }, "Bob joined"],
    [{ kind: "member_removed", slug: "bob", name: "Bob", private: true }, "Bob left"],
    [{ kind: "created", roomId: "r", title: "Sunny morning" }, "Sunny morning is ready"],
    [{ kind: "agent_message", from: "kiko", to: "ada" }, "KIKO messaged ADA"],
  ])("%j", (event, want) => {
    expect(line(event)).toBe(want);
  });

  test("a kind from a newer server has no line", () => {
    expect(line({ kind: "from_a_newer_server" })).toBeNull();
    expect(line({ kind: "subagent", agent: "kiko", state: "started", title: "x", private: true })).toBeNull();
  });
});

describe("the label of a folded agent thread", () => {
  test("one message names who messaged whom, more count the exchange", () => {
    expect(threadLabel(["Kiko", "Ada"], 1)).toBe("Kiko messaged Ada");
    expect(threadLabel(["Kiko", "Ada"], 3)).toBe("Kiko and Ada exchanged 3 messages");
    expect(threadLabel(["Kiko", "Ada", "Bob"], 1)).toBe("Kiko, Ada and Bob exchanged 1 message");
  });
});
