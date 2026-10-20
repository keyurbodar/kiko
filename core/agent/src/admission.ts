import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { GenerationTask, InboxDoc, LiveDoc, type Conversation, type SubmissionDraft } from "@earendil-works/pi-durable"

type Input = Extract<SubmissionDraft, { type: "input" }>

export async function submitPaused(root: Conversation, draft: Input): Promise<void> {
  await root.commit(async (tx) => {
    if (draft.requestId && await tx.submissionByRequest(root.id, draft.requestId)) return
    const live = await tx.doc(LiveDoc, root.id)
    const inbox = await tx.doc(InboxDoc, root.id)
    const submission = await tx.createSubmission({ conversationId: root.id, requestId: draft.requestId, type: "input", status: "queued" })
    if (live.run) {
      inbox.items.push({ id: submission.id, mode: draft.whenBusy === "steer" ? "steer" : "followUp", content: draft.content, ...(draft.entry ? { entry: draft.entry } : {}) })
      return
    }
    const users = []
    for (const item of [...inbox.items, { id: submission.id, mode: "followUp" as const, content: draft.content, entry: draft.entry }]) {
      if (item.mode === "write") throw new Error("A paused idle input cannot bypass a queued write")
      const entry = await tx.appendEntry(root.id, { kind: item.entry?.kind ?? "pi.user", ...(item.entry?.data === undefined ? {} : { data: item.entry.data }),
        model: [{ role: "user", content: item.content, timestamp: Date.now() }],
      })
      tx.placeSubmission(item.id, entry.id)
      users.push(item.id)
    }
    inbox.items = []
    live.run = { taskId: await tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" }, conversationId: root.id }), inputs: users }
  }, BACKGROUND_CONTEXT)
}
