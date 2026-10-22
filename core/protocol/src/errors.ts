type ErrorCode =
	| "composio_missing"
	| "composio_rejected"
	| "composio_down"
	| "kernel_missing"
	| "kernel_rejected"
	| "kernel_down"
	| "storage"
	| "model"
	| "protocol"

export type ErrorAction = "open_models" | "open_integrations"

export type KikoError = {
	code: ErrorCode
	message: string
	action?: ErrorAction
}
