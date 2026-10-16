/**
 * An error the human must know about, in words they can act on. The server writes the message in
 * sentence case with no stack, no provider JSON, and no key. The client shows it as one toast.
 */
type ErrorCode =
	| "composio_missing"
	| "composio_rejected"
	| "composio_down"
	| "kernel_missing"
	| "kernel_rejected"
	| "kernel_down"
	| "storage"

/** What the toast button does. The client owns the navigation. */
export type ErrorAction = "open_models" | "open_integrations"

export type KikoError = {
	code: ErrorCode
	message: string
	action?: ErrorAction
}
