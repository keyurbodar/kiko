import { expect, test } from "bun:test"
import type { AgentSlug, RichText, Sender } from "@kiko/protocol"
import { bubbleTouch, chatTouch } from "../src/room/chat-touch"
import { RoomLog } from "../src/room/log"
import { ROOM_STEPS } from "../src/room/schema"
import { searchMessages, snippetOf } from "../src/room/search"
import { SNIPPET_CLOSE, SNIPPET_OPEN, snippetText } from "@kiko/protocol"
import { parseRichText } from "../src/room/rich-text"
import { sqlWith } from "./sql-shim"

const ebert = "ebert" as AgentSlug
const human: Sender = { kind: "human" }
const agent: Sender = { kind: "agent", slug: ebert }

function room() {
	const sql = sqlWith(ROOM_STEPS)
	const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
	let clock = Date.UTC(2026, 8, 1)
	const log = new RoomLog(storage, () => (clock += 60_000))
	sql.exec("INSERT INTO members (slug, name, role, model, lead, status, added_seq, removed_at) VALUES ('ebert', 'Ebert', '', '', 1, 'idle', 0, NULL)")
	return { sql, log }
}

const say = (log: RoomLog, text: string, extra: { to?: AgentSlug | "all" } = {}) => log.addMessage({ from: agent, text, rich: parseRichText(text) as RichText, ...extra })

test("the chat list and search show an agent's words, not its markdown", () => {
	const { sql, log } = room()
	say(log, "**Inception: 8/10.** Smart dream heist")
	expect(chatTouch(sql, log).last?.text).toBe("Inception: 8/10. Smart dream heist")
	const [hit] = searchMessages(sql, "inception").results
	expect(hit?.snippet).toBe(`${SNIPPET_OPEN}Inception${SNIPPET_CLOSE}: 8/10. Smart dream heist`)
	expect(snippetText(hit?.snippet ?? "")).not.toContain("*")
})

test("mail between agents is not a preview or a search result", () => {
	const { sql, log } = room()
	log.addMessage({ from: human, text: "take on inception" })
	say(log, "@ebert give your take on inception", { to: ebert })
	expect(chatTouch(sql, log).last?.text).toBe("take on inception")
	expect(searchMessages(sql, "inception").results.map((r) => r.from.kind)).toEqual(["human"])
	expect(searchMessages(sql, "inception", { mail: true }).results).toHaveLength(2)
})

test("a snippet is a window of plain words around the first match", () => {
	const long = `${"word ".repeat(40)}needle ${"tail ".repeat(60)}`
	const out = snippetOf(long, "needle")
	expect(out.startsWith("…")).toBe(true)
	expect(out.endsWith("…")).toBe(true)
	expect(out).toContain(`${SNIPPET_OPEN}needle${SNIPPET_CLOSE}`)
})

test("a bubble of mail between agents moves the counts and leaves the last line alone", () => {
	const { sql, log } = room()
	const { event } = log.addMessage({ from: agent, text: "@piko take this", to: "piko" as AgentSlug })
	const posted = event as Extract<NonNullable<typeof event>, { t: "message" }>
	expect(bubbleTouch(sql, log, posted).last).toBeUndefined()
	const said = log.addMessage({ from: agent, text: "**hi** there", rich: parseRichText("**hi** there") as RichText }).event as Extract<NonNullable<typeof event>, { t: "message" }>
	expect(bubbleTouch(sql, log, said).last?.text).toBe("hi there")
})
