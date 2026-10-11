
export const MAX_HOP = 8
export const MAX_DELIVERIES_PER_ROOT = 40
export const MAX_AUTONOMOUS_RUNS_PER_DAY = 50

export type Limit = "hop" | "root"

export type SendCheck = { ok: true } | { ok: false; limit: Limit }

export function checkSend(hop: number, delivered: number, recipients: number): SendCheck {
	if (hop > MAX_HOP) return { ok: false, limit: "hop" }
	if (delivered + recipients > MAX_DELIVERIES_PER_ROOT) return { ok: false, limit: "root" }
	return { ok: true }
}

export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10)

export const nextReset = (now: number): number => Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1)

export function autonomousRunAllowed(counter: { day: string; runs: number } | null, day: string): boolean {
	const runs = counter?.day === day ? counter.runs : 0
	return runs < MAX_AUTONOMOUS_RUNS_PER_DAY
}

export function limitError(limit: Limit): string {
	const why =
		limit === "hop"
			? `this exchange between agents reached ${MAX_HOP} hops`
			: `this request already caused ${MAX_DELIVERIES_PER_ROOT} messages between agents`
	return `not sent: ${why}, which is the room's limit. do not message other agents about this. summarize what the team has so far for the human in a short reply.`
}

export function limitNotice(limit: Limit): string {
	return limit === "hop"
		? `agents paused: their exchange reached ${MAX_HOP} hops. send a message to continue.`
		: `agents paused: this request reached ${MAX_DELIVERIES_PER_ROOT} messages between agents. send a message to continue.`
}

export const BUDGET_LINE = (whose: string) => `agents paused their own work for today: ${whose} used its runs that start without you. send a message to go on.`
