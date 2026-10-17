import { expect, test } from "bun:test"
import type { CatalogProvider } from "../../settings/catalog"
import { firstRunChoices } from "./choices"

const provider = (id: string, over: Partial<CatalogProvider> = {}): CatalogProvider => ({ id, name: id, connect: ["api_key"], models: [], classifiers: 0, ...over })

const catalog = [
  provider("openrouter"),
  provider("anthropic", { connect: ["api_key", "paste_code"], signIn: { method: "paste_code", label: "Anthropic (Claude Pro/Max)" } }),
  provider("openai", { name: "OpenAI", connect: ["api_key", "paste_code"], signIn: { method: "paste_code", label: "Sign in with ChatGPT" } }),
  provider("github-copilot", { name: "GitHub Copilot", connect: ["device_code"], signIn: { method: "device_code", label: "GitHub Copilot" } }),
  provider("opencode-go", { name: "OpenCode Go" }),
]

test("plans come first, titled with the provider's sign-in label, then keys", () => {
  expect(firstRunChoices(catalog).map((c) => [c.provider.id, c.via, c.title])).toEqual([
    ["openai", "sign_in", "Sign in with ChatGPT"],
    ["anthropic", "sign_in", "Anthropic (Claude Pro/Max)"],
    ["github-copilot", "sign_in", "GitHub Copilot"],
    ["opencode-go", "api_key", "OpenCode Go"],
    ["openrouter", "api_key", "openrouter"],
  ])
})

test("a plan row opens only when the server runs that provider's sign-in", () => {
  const keyOnly = catalog.map((p) => (p.id === "anthropic" ? provider("anthropic") : p))
  expect(firstRunChoices(keyOnly).some((c) => c.provider.id === "anthropic")).toBe(false)
})

test("a sign-in the server cannot run, or a missing provider, is left out", () => {
  const noSignIn = catalog.map((p) => (p.id === "openai" ? provider("openai", { connect: ["api_key"] }) : p)).filter((p) => p.id !== "github-copilot")
  expect(firstRunChoices(noSignIn).map((c) => c.provider.id)).toEqual(["anthropic", "opencode-go", "openrouter"])
})
