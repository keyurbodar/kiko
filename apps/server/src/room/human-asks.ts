import type { AgentSlug, HumanAsk, MessageId } from "@kiko/protocol"

export const MAX_QUESTION = 2_000
const MAX_OPTIONS = 8
const MAX_OPTION = 120

type HumanAskState = { state: "open" | "answered" | "skipped"; answer: string | null }

type Row = { id: string; asker: string; question: string; questions: string | null; options: string | null; message_id: string }

const toAsk = (r: Row): HumanAsk => ({
	id: r.id,
	from: r.asker as AgentSlug,
	text: r.question,
	...(r.options ? { options: JSON.parse(r.options) as string[] } : {}),
	...(r.questions ? { questions: JSON.parse(r.questions) as NonNullable<HumanAsk["questions"]> } : {}),
	messageId: r.message_id as MessageId,
})

export function listAsks(sql: SqlStorage): HumanAsk[] {
	return sql
		.exec<Row>("SELECT id, asker, question, questions, options, message_id FROM human_asks WHERE state = 'open' ORDER BY at, id")
		.toArray()
		.map(toAsk)
}

export function cleanOptions(options: readonly string[] | undefined): string[] {
	return (options ?? [])
		.map((o) => o.trim().slice(0, MAX_OPTION))
		.filter((o, i, all) => o !== "" && all.indexOf(o) === i)
		.slice(0, MAX_OPTIONS)
}

export class HumanAsks {
	constructor(private readonly sql: SqlStorage) {}

	get(id: string): (HumanAsk & HumanAskState) | null {
		const row = this.sql.exec<Row & HumanAskState>("SELECT id, asker, question, questions, options, message_id, state, answer FROM human_asks WHERE id = ?", id).toArray()[0]
		return row ? { ...toAsk(row), state: row.state, answer: row.answer } : null
	}

	create(ask: HumanAsk, now: number): void {
		this.sql.exec(
			"INSERT INTO human_asks (id, asker, question, questions, options, message_id, at, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')",
			ask.id,
			ask.from,
			ask.text,
			ask.questions ? JSON.stringify(ask.questions) : null,
			ask.options?.length ? JSON.stringify(ask.options) : null,
			ask.messageId,
			now,
		)
	}

	resolve(id: string, state: "answered" | "skipped", answer: string | null): boolean {
		return this.sql.exec("UPDATE human_asks SET state = ?, answer = ? WHERE id = ? AND state = 'open'", state, answer, id).rowsWritten > 0
	}
}
