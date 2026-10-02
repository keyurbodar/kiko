// Architecture section 7.7. The loop limits of a room, as constants and pure functions. The room
// keeps the counters (deliver.ts) and asks these functions before it stores an agent message or
// starts an autonomous run. ASSUMPTION: the numbers, as the architecture says.

/** The highest hop an agent message may carry. A human message is hop 0. */
export const MAX_HOP = 8
/** Agent deliveries one root (a human message or a schedule) may cause, over its whole chain. */
export const MAX_DELIVERIES_PER_ROOT = 40
/** Scheduled and task-triggered runs per room per UTC day, until the next human message. */
export const MAX_AUTONOMOUS_RUNS_PER_DAY = 50

export type Limit = "hop" | "root"

export type SendCheck = { ok: true } | { ok: false; limit: Limit }

/**
 * Whether an agent message may be stored and delivered. `hop` is the hop the message would carry,
 * `delivered` the agent deliveries its root caused so far, and `recipients` the deliveries this
 * message adds. A broadcast that would pass the root limit is refused whole, so the count never
 * passes it.
 */
export function checkSend(hop: number, delivered: number, recipients: number): SendCheck {
	if (hop > MAX_HOP) return { ok: false, limit: "hop" }
	if (delivered + recipients > MAX_DELIVERIES_PER_ROOT) return { ok: false, limit: "root" }
	return { ok: true }
}

/** The UTC day of `now`, as `yyyy-mm-dd`. The daily counter is keyed by it. */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10)

/** Whether one more autonomous run may start, given the runs counted for `day`. A new day starts at 0. */
export function autonomousRunAllowed(counter: { day: string; runs: number } | null, day: string): boolean {
	const runs = counter?.day === day ? counter.runs : 0
	return runs < MAX_AUTONOMOUS_RUNS_PER_DAY
}

/** The tool error for a tripped limit. It tells the agent to stop messaging and answer the human. */
export function limitError(limit: Limit): string {
	const why =
		limit === "hop"
			? `this exchange between agents reached ${MAX_HOP} hops`
			: `this request already caused ${MAX_DELIVERIES_PER_ROOT} messages between agents`
	return `not sent: ${why}, which is the room's limit. do not message other agents about this. summarize what the team has so far for the human in a short reply.`
}

/** The system event the room posts once per root when a limit trips. Lowercase, for the chat. */
export function limitNotice(limit: Limit): string {
	return limit === "hop"
		? `agents paused: their exchange reached ${MAX_HOP} hops. send a message to continue.`
		: `agents paused: this request reached ${MAX_DELIVERIES_PER_ROOT} messages between agents. send a message to continue.`
}
