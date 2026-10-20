import type { CatalogProvider } from "../../settings/catalog"

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

const offers = (provider: CatalogProvider, via: ConnectVia) => (via === "sign_in" ? provider.signIn !== undefined : provider.connect.includes("api_key"))

export function firstRunChoices(providers: readonly CatalogProvider[]): FirstRunChoice[] {
  return CHOICES.flatMap(({ id, via, note }) => {
    const provider = providers.find((p) => p.id === id)
    if (!provider || !offers(provider, via)) return []
    return [{ provider, via, note, title: via === "sign_in" ? (provider.signIn?.label ?? provider.name) : provider.name }]
  })
}

export const CHOICE_ROWS = CHOICES.length
