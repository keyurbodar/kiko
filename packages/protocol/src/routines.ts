// Architecture section 25. What starts a routine. A routine is a reminder with instructions for an
// agent: the same table, the same alarm (section 14). The schedule's time zone is the user's.

import type { TaskStatus } from "./room"

/** One condition on a webhook's JSON body. `path` is dot-separated (`pull_request.state`). */
export type WebhookMatch = { path: string; equals?: string | number | boolean; contains?: string }

export type Trigger =
	/** `at` is the first run, ISO 8601 with an offset or `Z`. `rrule` repeats it (RFC 5545). */
	| { on: "time"; at: string; rrule?: string }
	/** A task in the routine's chat changes to one of `status`, or to any status. */
	| { on: "task"; status?: readonly TaskStatus[] }
	/** A message in the routine's chat, from the human, an agent, or either, optionally containing `contains`. */
	| { on: "message"; from: "human" | "agent" | "any"; contains?: string }
	/** A file under `path` in the routine's chat is added, changed, or removed. */
	| { on: "file"; path: string }
	/** A POST to the routine's hook URL whose JSON body meets every condition. */
	| { on: "webhook"; match?: readonly WebhookMatch[] }
	/**
	 * A page checked every `everyMinutes` without a model. The agent wakes only when it changed. With
	 * `extension`, the request goes through that installed extension, so its egress applies and `headers`
	 * may name its secrets as `{{secret.NAME}}`.
	 */
	| { on: "watch"; url: string; everyMinutes: number; extension?: string; headers?: Readonly<Record<string, string>> }

export type TriggerKind = Trigger["on"]

export type RoutineRunStatus = "running" | "ok" | "quiet" | "failed" | "held" | "timeout"
