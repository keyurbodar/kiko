import type { CatalogModel, CatalogProvider } from "../../settings/catalog"

export type ConnectVia = "sign_in" | "api_key"

export interface FirstRunChoice {
  provider: CatalogProvider
  via: ConnectVia
  title: string
  note: string
}

const CHOICES: readonly { id: string; via: ConnectVia; note: string }[] = [
  { id: "openai", via: "sign_in", note: "Use your ChatGPT Plus or Pro plan." },
  { id: "anthropic", via: "sign_in", note: "Use your Claude Pro or Max plan." },
  { id: "github-copilot", via: "sign_in", note: "Use the models in your Copilot plan." },
  { id: "opencode-go", via: "api_key", note: "Low-cost open models from OpenCode." },
  { id: "openrouter", via: "api_key", note: "Many providers' models behind one key." },
]

const offers = (provider: CatalogProvider, via: ConnectVia) =>
  via === "sign_in" ? provider.signIn !== undefined : provider.connect.includes("api_key")

export function firstRunChoices(providers: readonly CatalogProvider[]): FirstRunChoice[] {
  return CHOICES.flatMap(({ id, via, note }) => {
    const provider = providers.find((p) => p.id === id)
    if (!provider || !offers(provider, via)) return []
    return [
      { provider, via, note, title: via === "sign_in" ? (provider.signIn?.label ?? provider.name) : provider.name },
    ]
  })
}

export const CHOICE_ROWS = CHOICES.length

export interface ModelChoice {
  provider: CatalogProvider
  model: CatalogModel
  ref: string
}

const isFree = (c: ModelChoice) => c.model.pricing.input === 0 && c.model.pricing.output === 0

export const rankModels = (list: readonly ModelChoice[]): ModelChoice[] =>
  [...list].sort(
    (a, b) =>
      Number(b.model.reasoning) - Number(a.model.reasoning) ||
      Number(isFree(a)) - Number(isFree(b)) ||
      b.model.contextWindow - a.model.contextWindow,
  )

export const startingModel = (ranked: readonly ModelChoice[], running: string | undefined): string | undefined =>
  ranked.find((c) => c.ref === running)?.ref ?? ranked[0]?.ref
