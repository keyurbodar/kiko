
export type WebhookMatch = { path: string; equals?: string | number | boolean; contains?: string }

export type Trigger =
	| { on: "time"; at: string; rrule?: string }
	| { on: "message"; contains?: string }
	| { on: "webhook"; match?: readonly WebhookMatch[] }


export type RoutineRunStatus = "running" | "ok" | "quiet" | "failed" | "held" | "timeout"
