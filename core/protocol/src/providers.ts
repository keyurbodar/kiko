/** Why a connected provider stopped working, as far as kiko can tell from real signals. */
export type ProviderProblem = "signed_out" | "key_refused" | "no_credit"

export interface ProviderInfo {
	provider: string
	kind: "api_key" | "oauth"
	last4: string
	/** From pi-ai's catalog, so a list without the catalog can tell a chat provider from a judge. */
	chat?: boolean
	judge?: boolean
	problem?: ProviderProblem
	/** When the problem was first seen, in epoch milliseconds. */
	problemAt?: number
}
