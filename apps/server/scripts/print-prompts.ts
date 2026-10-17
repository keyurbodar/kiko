// Renders the assembled talker prompt and the worker prompt to /tmp/kiko-program/prompt-*.txt so a
// reviewer can read the exact text a model sees. Run: bun apps/server/scripts/print-prompts.ts
import { statSync, writeFileSync } from "node:fs"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Harness, MemoryStorage } from "@earendil-works/pi-durable"
import { buildAgent } from "../src/agent/factory"
import { WORKER_PROMPT } from "../src/agent/extensions/work"

const dir = "/tmp/kiko-program"
const FAUX = { provider: "faux", modelId: "faux-1" }

type System = { role: string; content?: string; sections?: Record<string, string | null> }

async function talkerPrompt(): Promise<string> {
  const built = buildAgent({ role: "you plan trips.", lead: true, model: FAUX })
  const faux = fauxProvider()
  let system = ""
  faux.setResponses([
    (request) => {
      const messages = (request as unknown as { messages: System[] }).messages
      system = messages
        .filter((m) => m.role === "system")
        .flatMap((m) => [m.content ?? "", ...Object.values(m.sections ?? {}).map((s) => s ?? "")])
        .join("\n")
      return fauxAssistantMessage("ok")
    },
  ])
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, BACKGROUND_CONTEXT)
  const root = await harness.root(BACKGROUND_CONTEXT, { agent: built.agent })
  await (await root.submit({ type: "input", content: "what can you do in this app?" }, BACKGROUND_CONTEXT)).wait(BACKGROUND_CONTEXT)
  await harness.close(BACKGROUND_CONTEXT)
  return system
}

writeFileSync(`${dir}/prompt-talker.txt`, await talkerPrompt())
writeFileSync(`${dir}/prompt-worker.txt`, WORKER_PROMPT)
console.log(`talker ${statSync(`${dir}/prompt-talker.txt`).size} bytes, worker ${statSync(`${dir}/prompt-worker.txt`).size} bytes`)
