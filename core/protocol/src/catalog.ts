import type { ThinkingLevel } from "./thinking"

export type ConnectMethod = "api_key" | "device_code" | "paste_code"

export interface CatalogModel {
	id: string
	name: string
	contextWindow: number
	maxTokens: number
	reasoning: boolean
	thinking: ThinkingLevel[]
	pricing: { input: number; output: number }
}

export interface CatalogProvider {
	id: string
	name: string
	connect: ConnectMethod[]
	signIn?: { method: ConnectMethod; label: string }
	models: CatalogModel[]
	classifiers: number
}

export interface Catalog {
	providers: CatalogProvider[]
}
