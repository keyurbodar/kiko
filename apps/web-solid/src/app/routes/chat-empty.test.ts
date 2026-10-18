import { expect, test } from "bun:test";
import type { ChatMessage } from "../../lib/types";
import { roomEmpty, roomSettled } from "./chat-empty";

const message = (extra: Partial<ChatMessage> = {}) =>
  ({ id: "m", threadId: "t", sender: "user", body: "hello", sentAt: 0, ...extra }) as ChatMessage;

/** The warm tier answered, but the socket has not replayed a single event. */
const connecting = { loaded: true, connection: "connecting", seq: 0 };
/** The socket is open, and the server's snapshot has not landed yet. */
const open = { loaded: true, connection: "open", seq: 0 };
/** The socket is still connecting, but the room has replayed events. */
const replayed = { loaded: true, connection: "connecting", seq: 12 };
/** The warm tier has not painted. */
const loading = { loaded: false, connection: "open", seq: 0 };

test("a loaded room that is still connecting and has replayed nothing is not settled", () => {
  expect(roomSettled(connecting, 0)).toBe(false);
  expect(roomEmpty(connecting, [], 0)).toBe(false);
});

test("a loaded room with a replayed event is settled and empty", () => {
  expect(roomSettled(replayed, 12)).toBe(true);
  expect(roomEmpty(replayed, [], 12)).toBe(true);
});

test("an open socket on a chat the list holds nothing for is settled and empty", () => {
  expect(roomSettled(open, 0)).toBe(true);
  expect(roomEmpty(open, [], 0)).toBe(true);
});

test("an open socket is not settled while the chat list holds events the room has not applied", () => {
  // The cold-start flash: loaded, open, no window yet, over a chat with twenty-two messages.
  expect(roomSettled(open, 22)).toBe(false);
  expect(roomEmpty(open, [], 22)).toBe(false);
  expect(roomSettled(replayed, 22)).toBe(false);
});

test("a room the chat list has not described is not settled", () => {
  expect(roomSettled(open, undefined)).toBe(false);
  expect(roomEmpty(open, [], undefined)).toBe(false);
});

test("a room that has not loaded is never settled, even with the socket open", () => {
  expect(roomSettled(loading, 0)).toBe(false);
  expect(roomEmpty(loading, [], 0)).toBe(false);
  expect(roomSettled(undefined, 0)).toBe(false);
  expect(roomEmpty(undefined, [], 0)).toBe(false);
});

test("a settled room with a message to read is not empty", () => {
  expect(roomEmpty(open, [message()], 0)).toBe(false);
  expect(roomEmpty(replayed, [message({ sender: "bot" })], 12)).toBe(false);
});

test("a settled room holding only a divider is empty only when the client draws no row for it", () => {
  const undrawn = message({ body: "", event: { kind: "unreadable" } as unknown as ChatMessage["event"] });
  expect(roomEmpty(open, [undrawn], 0)).toBe(true);
  const drawn = message({ body: "", event: { kind: "member_added", slug: "ada", name: "Ada", private: true } as unknown as ChatMessage["event"] });
  expect(roomEmpty(open, [drawn], 0)).toBe(false);
});
