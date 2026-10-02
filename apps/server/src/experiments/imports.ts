// Experiments 5, 6 and 7 (docs/research/experiment-5-bundle-and-catalog.md).
// Static imports pull pi-ai, pi-durable and TypeBox into the Worker bundle so
// the bundle size and startup time can be measured. Each OAuth flow module is
// imported by a literal path in its own dynamic import, so the bundler follows
// it and a failure shows up per module instead of failing the whole Worker.
import { createModels } from "@earendil-works/pi-ai/models"
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go"
import * as durable from "@earendil-works/pi-durable"
import { Type } from "typebox"

const flows = {
  anthropic: () => import("../../node_modules/@earendil-works/pi-ai/dist/auth/oauth/anthropic.js"),
  "openai-codex": () => import("../../node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js"),
  "openai-chatgpt": () => import("../../node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js"),
  "github-copilot": () => import("../../node_modules/@earendil-works/pi-ai/dist/auth/oauth/github-copilot.js"),
  openrouter: () => import("../../node_modules/@earendil-works/pi-ai/dist/auth/oauth/openrouter.js"),
  "kimi-coding": () => import("../../node_modules/@earendil-works/pi-ai/dist/auth/oauth/kimi-coding.js"),
  meta: () => import("../../node_modules/@earendil-works/pi-ai/dist/auth/oauth/meta.js"),
  xai: () => import("../../node_modules/@earendil-works/pi-ai/dist/auth/oauth/xai.js"),
  radius: () => import("../../node_modules/@earendil-works/pi-ai/dist/auth/oauth/radius.js"),
} as const

export async function runImports() {
  const flowResults: Record<string, string> = {}
  for (const [name, load] of Object.entries(flows)) {
    try {
      const mod = await load()
      flowResults[name] = `imports (${Object.keys(mod).join(", ")})`
    } catch (error) {
      flowResults[name] = `fails: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const models = createModels()
  models.setProvider(opencodeGoProvider())
  const deepseekIds = models
    .getModels("opencode-go")
    .filter((m) => /deepseek/i.test(m.id))
    .map((m) => m.id)

  return {
    durableExports: Object.keys(durable).length,
    typebox: Type.Object({ a: Type.String() }).type,
    opencodeGoDeepseekIds: deepseekIds,
    flows: flowResults,
  }
}
