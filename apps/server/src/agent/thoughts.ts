import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { EntryRecord, SubmissionRecord } from "@earendil-works/pi-durable"
import type { JournalStorage } from "@kiko/agent/journal"
import type { ThoughtPart } from "@kiko/protocol"

const context = BACKGROUND_CONTEXT
const PAGE = 100

type AssistantPart = { type?: string; thinking?: string }
type Assistant = { role?: string; content?: readonly AssistantPart[]; timestamp?: number; durationMs?: number }

type Group = { id: number; first: number; until: number; conversation: EntryRecord["conversationId"] }

const safe = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.round(value))

async function everySubmission(journal: JournalStorage): Promise<SubmissionRecord[]> {
  const out: SubmissionRecord[] = []
  let cursor: Parameters<JournalStorage["scanSubmissions"]>[2]
  do {
    const page = await journal.scanSubmissions({}, PAGE, cursor, context)
    out.push(...page.items)
    cursor = page.next
  } while (cursor)
  return out
}

async function groupsOf(journal: JournalStorage): Promise<{ groups: Group[]; bySubmission: Map<number, Group> }> {
  const groups = new Map<number, { first: number; conversation: EntryRecord["conversationId"] }>()
  const owners = new Map<number, number>()
  for (const submission of await everySubmission(journal)) {
    if (submission.type !== "input" || submission.entry === undefined) continue
    const id = journal.settlement(submission.id) ?? -submission.id
    owners.set(submission.id, id)
    const known = groups.get(id)
    if (known) {
      known.first = Math.min(known.first, submission.entry)
      continue
    }
    groups.set(id, { first: submission.entry, conversation: submission.conversationId })
  }
  const ordered = [...groups]
    .map(([id, group]) => ({
      id,
      first: group.first,
      conversation: group.conversation,
      until: Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.first - b.first)
  for (const [index, group] of ordered.entries()) {
    const next = ordered[index + 1]
    if (next) group.until = next.first - 1
  }
  const byId = new Map(ordered.map((group) => [group.id, group]))
  const bySubmission = new Map<number, Group>()
  for (const [submission, owner] of owners) {
    const group = byId.get(owner)
    if (group) bySubmission.set(submission, group)
  }
  return { groups: ordered, bySubmission }
}

async function assistantEntries(journal: JournalStorage, group: Group): Promise<EntryRecord[]> {
  const out: EntryRecord[] = []
  let cursor: Parameters<JournalStorage["scanEntries"]>[2]
  do {
    const page = await journal.scanEntries(
      {
        conversationId: group.conversation,
        minEntryId: group.first as EntryRecord["id"],
        ...(Number.isFinite(group.until) ? { maxEntryId: group.until as EntryRecord["id"] } : {}),
        order: "ascending",
      },
      PAGE,
      cursor,
      context,
    )
    for (const entry of page.items) if (entry.kind === "pi.assistant") out.push(entry)
    cursor = page.next
  } while (cursor)
  return out
}

function thinkingText(entry: EntryRecord): string {
  const message = entry.model?.[0] as Assistant | undefined
  return (message?.content ?? [])
    .flatMap((part) => (part.type === "thinking" && typeof part.thinking === "string" ? [part.thinking.trim()] : []))
    .filter(Boolean)
    .join("\n\n")
}

function partOf(entry: EntryRecord, part: number): ThoughtPart {
  const message = entry.model?.[0] as Assistant | undefined
  return {
    part,
    text: thinkingText(entry),
    startedAt: safe(message?.timestamp),
    spentMs: safe(message?.durationMs),
  }
}

export async function journalThoughts(journal: JournalStorage, runId: string): Promise<ThoughtPart[]> {
  const suffix = Number(runId.slice(runId.lastIndexOf(":") + 1))
  if (!Number.isSafeInteger(suffix)) return []
  const { groups, bySubmission } = await groupsOf(journal)
  const group = groups.find((found) => found.id === suffix) ?? bySubmission.get(suffix)
  if (!group) return []
  return (await assistantEntries(journal, group)).map((entry, part) => partOf(entry, part))
}
