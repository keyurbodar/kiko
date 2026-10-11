
import type { TaskStatus } from "./room"

export type WebhookMatch = { path: string; equals?: string | number | boolean; contains?: string }

export type Trigger =
	| { on: "time"; at: string; rrule?: string }
	| { on: "task"; status?: readonly TaskStatus[] }
	| { on: "message"; from: "human" | "agent" | "any"; contains?: string }
	| { on: "file"; path: string }
	| { on: "webhook"; match?: readonly WebhookMatch[] }
	/**
	 * A page checked every `everyMinutes` without a model. The agent wakes only when it changed. With
	 * `extension`, the request goes through that installed extension, so its egress applies and `headers`
	 * may name its secrets as `{{secret.NAME}}`.
	 */
	| { on: "watch"; url: string; everyMinutes: number; extension?: string; headers?: Readonly<Record<string, string>> }


export type RoutineRunStatus = "running" | "ok" | "quiet" | "failed" | "held" | "timeout"
