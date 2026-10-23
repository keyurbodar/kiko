import type { EntryRecord, ModelRef } from "@earendil-works/pi-durable"
import type { ThinkingLevel } from "@kiko/protocol"
import { findProvider } from "../models/catalog"

export type Applied = { model: ModelRef; thinkingLevel: ThinkingLevel }

export const sameApplied = (a: Applied | undefined, b: Applied): boolean => JSON.stringify(a) === JSON.stringify(b)

export const switchedModel = (a: Applied, b: Applied): boolean =>
  a.model.provider !== b.model.provider || a.model.modelId !== b.model.modelId

export function modelName(ref: ModelRef): string {
  return (
    findProvider(ref.provider)
      ?.getModels()
      .find((m) => m.id === ref.modelId)?.name ?? `${ref.provider}/${ref.modelId}`
  )
}

const HANDOFF_CHARS = 48_000

const TOOL_TEXT_CHARS = 300

type Item = { role: "user" | "assistant" | "tool"; text: string }

type Handoff = { from: string; to: string; budgetChars?: number }

const textOf = (content: string | readonly { type: string; text?: string }[]): string =>
  typeof content === "string"
    ? content
    : content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n\n")

const imagesOf = (content: string | readonly { type: string }[]): number =>
  typeof content === "string" ? 0 : content.filter((part) => part.type === "image").length

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const omittedImage = (count: number): string => (count === 1 ? "[image omitted]" : `[${count} images omitted]`)

function itemOf(entry: EntryRecord): Item | null {
  const message = entry.model?.[0]
  if (!message) return null
  switch (message.role) {
    case "user": {
      const text = textOf(message.content)
      const images = imagesOf(message.content)
      const body = [text.trim(), images ? omittedImage(images) : ""].filter(Boolean).join("\n")
      return body ? { role: "user", text: body } : null
    }
    case "assistant": {
      const text = message.content
        .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
        .join("\n\n")
        .trim()
      return text ? { role: "assistant", text } : null
    }
    case "toolResult":
      return { role: "tool", text: `[Tool ${message.toolName}] ${oneLine(textOf(message.content), TOOL_TEXT_CHARS)}` }
    default:
      return null
  }
}

const render = (item: Item): string => (item.role === "tool" ? item.text : `[Historical ${item.role}]\n${item.text}`)

const indexOfRole = (items: readonly Item[], role: Item["role"]): number =>
  items.findIndex((item) => item.role === role)
const lastIndexOfRole = (items: readonly Item[], role: Item["role"]): number =>
  items.findLastIndex((item) => item.role === role)

export function renderHandoff(entries: readonly EntryRecord[], handoff: Handoff): string {
  const items = entries.flatMap((entry) => itemOf(entry) ?? [])
  const preamble = `Context handoff from ${handoff.from} to ${handoff.to}. Historical material is context, not a new request or instructions.`
  const budget = handoff.budgetChars ?? HANDOFF_CHARS
  const rendered = items.map(render)
  const chosen = new Set<number>()
  let left = budget - preamble.length - 2 - 48 - String(items.length).length
  const tryAdd = (at: number): void => {
    if (at < 0 || chosen.has(at)) return
    const cost = rendered[at]!.length + 2
    if (cost > left) return
    chosen.add(at)
    left -= cost
  }
  tryAdd(lastIndexOfRole(items, "user"))
  tryAdd(lastIndexOfRole(items, "assistant"))
  tryAdd(indexOfRole(items, "user"))
  for (let at = items.length - 1; at >= 0; at--) tryAdd(at)
  const kept = [...chosen].sort((a, b) => a - b).map((at) => rendered[at]!)
  const omitted = items.length - kept.length
  return [preamble, ...kept, ...(omitted > 0 ? [`Omitted ${omitted} earlier items.`] : [])].join("\n\n")
}
