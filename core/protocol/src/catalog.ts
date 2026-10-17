import type { ThinkingLevel } from "./thinking"

export type ConnectMethod = "api_key" | "device_code" | "paste_code"

export interface CatalogModel {
	id: string
	name: string
	contextWindow: number
	maxTokens: number
	reasoning: boolean
	/** The reasoning levels the model supports, from pi-ai. Only "off" when it cannot reason. */
	thinking: ThinkingLevel[]
	/** Dollars per million tokens. */
	pricing: { input: number; output: number }
}

export interface CatalogProvider {
	id: string
	name: string
	connect: ConnectMethod[]
	models: CatalogModel[]
	/** How many classifier models the provider serves. */
	classifiers: number
}

export interface Catalog {
	providers: CatalogProvider[]
}
