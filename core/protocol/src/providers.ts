export type ProviderProblem = "signed_out" | "key_refused" | "no_credit"

export interface ProviderInfo {
  provider: string
  kind: "api_key" | "oauth"
  last4: string
  chat?: boolean
  judge?: boolean
  problem?: ProviderProblem
  problemAt?: number
}
