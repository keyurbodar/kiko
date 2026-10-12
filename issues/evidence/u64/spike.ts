// U64 spike: send status questions to the real lead through the yuki CLI client, only once a worker is running.
// Usage (from the worktree root, with the server on port 8864 in the same heavy slot):
//   set -a; . apps/server/.dev.vars; set +a; bun issues/evidence/u64/spike.ts run1 [caseIds]
import { mkdir, writeFile } from "node:fs/promises"
import type { RoomToClient } from "@yuki/protocol"
import { connectTestModel, createVerifier, type Session } from "../../../apps/cli/src/verify/client"
import { newRoom, seen, send } from "../../../apps/cli/src/verify/suites/mid-run"

const BASE = "http://localhost:8864"
const RUN = process.argv[2] ?? "run1"
const ONLY = (process.argv[3] ?? "7,10").split(",").filter(Boolean).map(Number)
const ONLY_WORDING = process.argv[4] ?? "status,going"
const DIR = `${import.meta.dir}/${RUN}`
const DEADLINE_MS = 300_000
const REPS = 3
const WORDINGS = [
  { tag: "status", text: "what is the status?" },
  { tag: "going", text: "how is it going?" },
] as const

type Counters = Record<string, number>
type Work = { id: string; task: string; status: string; delivered: boolean; step: string | null }
type Case = { id: number; name: string; files?: Record<string, string>; send: string[]; status?: boolean; note?: string }
type Wording = (typeof WORDINGS)[number]

const SENTENCES = ["Our sprint was short.", "Sales grew in March.", "Two hires started.", "The cache bug is fixed.", "Support volume fell."]
const PROJECTS = ["alpha", "beta", "gamma", "delta"]
const SITE: Record<string, string> = {
  "site/home.md": "# Acme\n\nWelcome to Acme.\n",
  "site/about.md": "About Acme: we make tools.\n",
  "site/pricing.md": "Acme Pro: $10 a month.\n",
  "site/faq.md": "Q: Is Acme open source?\nA: No.\n",
  "site/footer.md": "© Acme\n",
  "site/contact.md": "Write to hi@acme.example\n",
}

const CASES: Case[] = [
  { id: 1, name: "rename a file", files: { "notes/draft.md": "# Draft\n\nFirst pass of the plan.\n" }, send: ["rename notes/draft.md to notes/final.md"] },
  { id: 2, name: "fix one typo", files: { "notes/typo.md": "The quick brwon fox jumps over the lazy dog.\n" }, send: ["fix the typo in notes/typo.md: brwon should be brown"] },
  { id: 3, name: "factual question from a file", files: { "facts/launch.md": "Office: Lisbon.\nLaunch date: 14 March 2027.\nOwner: Dana.\n" }, send: ["from facts/launch.md, when is the launch?"] },
  { id: 4, name: "add a line to three files", files: { "notes/a.md": "# A\n", "notes/b.md": "# B\n", "notes/c.md": "# C\n" }, send: ["add the line 'Reviewed by Sam' at the end of notes/a.md, notes/b.md and notes/c.md"] },
  { id: 5, name: "600 word draft", send: ["write a 600 word draft on why small teams should keep a shared decision log. save it as drafts/decision-log.md"], status: true, note: "one note: keep it short" },
  { id: 6, name: "summarize five files", files: Object.fromEntries(SENTENCES.map((s, i) => [`reports/r${i + 1}.md`, `Report ${i + 1}: ${s}\n`])), send: ["summarize the five files in reports/ into reports/summary.md, one paragraph each"], status: true, note: "do it fast" },
  { id: 7, name: "web research and short report", send: ["research the three most used open source vector databases on the web and write a short report in research/vectors.md"], status: true, note: "do it fast" },
  { id: 8, name: "restructure a small folder", files: Object.fromEntries(PROJECTS.map((p) => [`projects/${p}.md`, `${p}: one line of notes.\n`])), send: ["restructure projects/ so each project has its own subfolder with its file inside. keep the names."], status: true, note: "one note: keep it short" },
  { id: 9, name: "bigger than it looks", files: SITE, send: ["change the company name from Acme to Initech everywhere in site/"], status: true, note: "do it fast" },
  { id: 10, name: "burst: one small, one large", files: { "notes/todo.md": "- buy milk\n" }, send: ["add 'Reviewed' at the top of notes/todo.md", "research the three most used JavaScript test runners on the web and write a short comparison in research/tests.md"], status: true, note: "one note: keep it short" },
]

const v = createVerifier(BASE)

async function api<T>(s: Session, path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(path, `${BASE}/`), {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie: s.cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!res.ok) throw new Error(`${path} answered ${res.status}`)
  return (await res.json()) as T
}

const counters = async (s: Session): Promise<Counters> => (await api<{ counters: Counters }>(s, "api/dev/stats")).counters
const workersOf = async (s: Session, roomId: string): Promise<Work[]> => (await api<{ workers: Work[] }>(s, `api/dev/agent/workers?roomId=${roomId}`)).workers
const sumPrefix = (c: Counters, prefix: string) => Object.entries(c).filter(([k]) => k.startsWith(prefix)).reduce((n, [, x]) => n + x, 0)
const pick = (c: Counters, prefix: string) => Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith(prefix)))
const diff = (a: Counters, b: Counters): Counters => Object.fromEntries(Object.entries(b).map(([k, x]) => [k, x - (a[k] ?? 0)]).filter(([, x]) => x !== 0))
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const brief = (w: Work) => ({ id: w.id, status: w.status, step: w.step })

async function runCase(c: Case, wording: Wording, rep: number) {
  const dir = `${DIR}/${wording.tag}-${rep}`
  await mkdir(dir, { recursive: true })
  const s = await v.as(`u64-${RUN}-${wording.tag}-${rep}-${c.id}`)
  try {
    await connectTestModel(s)
    const { roomId, room } = await newRoom(s, `u64 ${c.name}`)
    for (const [path, body] of Object.entries(c.files ?? {})) {
      const res = await s.putFile(roomId, path, body, { expect: "none" })
      if (!res.ok) throw new Error(`putFile ${path} answered ${res.status}`)
    }
    await api(s, "api/dev/stats/reset", {})

    const t0 = Date.now()
    const at = () => Date.now() - t0
    for (const text of c.send) await send(room, text)
    const sentAt = at()

    const replies: { at: number; text: string }[] = []
    const seenIds = new Set<string>()
    const statuses: { at: number; state: string }[] = []
    const snapshots: { at: number; workers: Work[] }[] = []
    let cursor = 0
    let lead = "none"
    let typingAt: number | null = null
    let everRunning = false
    let statusSent: { at: number; before: Counters; workersAtSend: Work[] } | null = null
    let statusReply: { at: number; after: Counters; workersAtReply: Work[] } | null = null
    let note: { at: number; skipped?: string; before?: Counters; runningAtSend?: number } | null = null
    let lastSnap = -Infinity
    let workers: Work[] = []
    let doneAt: number | null = null

    while (at() < DEADLINE_MS) {
      const now = at()
      while (cursor < room.raw.log.length) {
        const e = room.raw.log[cursor++]
        if (e.dir !== "in") continue
        const f = e.frame as RoomToClient
        if (f.t === "status") {
          statuses.push({ at: now, state: f.state })
          lead = f.state
          if (f.state === "typing" && typingAt === null) typingAt = now
        }
        if (f.t === "events") {
          for (const ev of f.events) {
            if (ev.t === "message" && ev.from.kind === "agent" && !seenIds.has(ev.id)) {
              seenIds.add(ev.id)
              replies.push({ at: now, text: ev.text })
            }
          }
        }
      }
      if (now - lastSnap >= 2000) {
        lastSnap = now
        workers = await workersOf(s, roomId)
        everRunning ||= workers.some((w) => w.status === "running")
        snapshots.push({ at: now, workers })
      }
      // The question goes out only when a worker is running at send time, checked against a fresh read.
      if (c.status && !statusSent && workers.some((w) => w.status === "running")) {
        const running = (await workersOf(s, roomId)).filter((w) => w.status === "running")
        if (running.length > 0) {
          const before = await counters(s)
          await send(room, wording.text)
          statusSent = { at: at(), before, workersAtSend: running }
          everRunning = true
          console.log(`  ${wording.tag}-${rep} case ${c.id}: status sent at ${statusSent.at} ms, ${running.length} worker(s) running`)
          continue
        }
      }
      if (statusSent && !statusReply) {
        const reply = replies.find((r) => r.at > statusSent!.at)
        if (reply) statusReply = { at: reply.at, after: await counters(s), workersAtReply: await workersOf(s, roomId) }
      }
      const anchor = statusReply?.at ?? (statusSent ? statusSent.at + 30_000 : null)
      if (c.note && anchor !== null && !note && now - anchor >= 5000) {
        workers = await workersOf(s, roomId)
        const runningAtSend = workers.filter((w) => w.status === "running").length
        if (runningAtSend === 0) {
          note = { at: at(), skipped: "no running worker" }
        } else {
          const before = await counters(s)
          await send(room, c.note)
          note = { at: at(), before, runningAtSend }
          console.log(`  note "${c.note}" sent at ${note.at} ms, ${runningAtSend} worker(s) running`)
        }
        continue
      }
      const quiet = replies.length ? now - replies[replies.length - 1]!.at : now
      const pendingStatus = statusSent !== null && statusReply === null
      const pendingNote = statusSent !== null && c.note !== undefined && note === null
      if (typingAt !== null && lead === "idle" && quiet >= 4000 && !pendingStatus && !pendingNote) {
        workers = await workersOf(s, roomId)
        if (workers.every((w) => w.delivered)) {
          doneAt = at()
          break
        }
      }
      await Bun.sleep(150)
    }

    // Never sent: the run ended before any worker was running (or none ever started).
    const statusSkipped = c.status && !statusSent ? (everRunning ? "worker finished before the question was sent" : "no worker started") : null
    const final = await counters(s)
    const finalWorkers = await workersOf(s, roomId)
    const statusNote = statusSent
      ? {
          wording: wording.text,
          replyMs: statusReply ? statusReply.at - statusSent.at : null,
          runningAtSend: statusSent.workersAtSend.length,
          workersAtSend: statusSent.workersAtSend.map(brief),
          workersAtReply: statusReply?.workersAtReply.map(brief) ?? null,
          talkerDuring: statusReply ? pick(diff(statusSent.before, statusReply.after), "tool.talker.") : null,
          workerDuring: statusReply ? pick(diff(statusSent.before, statusReply.after), "tool.worker.") : null,
          steerWorkDuring: statusReply ? (diff(statusSent.before, statusReply.after)["tool.talker.steer_work"] ?? 0) : null,
          stopWorkDuring: statusReply ? (diff(statusSent.before, statusReply.after)["tool.talker.stop_work"] ?? 0) : null,
          reply: replies.find((r) => r.at > statusSent!.at)?.text ?? null,
          repliesAfterSend: replies.filter((r) => r.at > statusSent!.at).map((r) => r.text),
        }
      : null
    const noteOut = note && note.before
      ? { sentMs: note.at, runningAtSend: note.runningAtSend, steerCalls: (final["tool.talker.steer_work"] ?? 0) - (note.before["tool.talker.steer_work"] ?? 0), stopCalls: (final["tool.talker.stop_work"] ?? 0) - (note.before["tool.talker.stop_work"] ?? 0), workerToolsAfter: sumPrefix(final, "tool.worker.") - sumPrefix(note.before, "tool.worker."), reply: replies.find((r) => r.at > note!.at)?.text ?? null }
      : note ? { skipped: note.skipped } : null
    const result = {
      run: RUN,
      case: c.id,
      name: c.name,
      wording: wording.text,
      wordingTag: wording.tag,
      rep,
      send: c.send,
      sentAt,
      timedOut: doneAt === null,
      doneMs: doneAt,
      firstReplyMs: replies[0]?.at ?? null,
      startWorkCalls: final["tool.talker.start_work"] ?? 0,
      talkerToolCalls: sumPrefix(final, "tool.talker."),
      talkerTools: pick(final, "tool.talker."),
      workerToolCalls: sumPrefix(final, "tool.worker."),
      workerTools: pick(final, "tool.worker."),
      modelTurns: final["model.turns"] ?? 0,
      workers: finalWorkers.map((w) => ({ id: w.id, status: w.status, delivered: w.delivered, task: clip(w.task, 120) })),
      statusSkipped,
      status: statusNote,
      note: noteOut,
      replies,
      bubbles: seen(room).live.map((m) => m.text),
    }
    const tag = String(c.id).padStart(2, "0")
    await writeFile(`${dir}/case-${tag}.json`, `${JSON.stringify(result, null, 2)}\n`)
    await writeFile(`${dir}/case-${tag}.frames.json`, `${JSON.stringify({ statuses, snapshots, final }, null, 2)}\n`)
    console.log(`${wording.tag}-${rep} case ${c.id} ${c.name}: start_work=${result.startWorkCalls} talker_calls=${result.talkerToolCalls} worker_calls=${result.workerToolCalls} turns=${result.modelTurns} first_reply=${result.firstReplyMs} done=${result.doneMs} timed_out=${result.timedOut} status_skipped=${statusSkipped}`)
    return result
  } finally {
    v.closeAll()
  }
}

await mkdir(DIR, { recursive: true })
const rows: string[] = ["wording\trep\tcase\tname\trunning_at_send\tstatus_skipped\tstatus_reply_s\tsteer_work\tstop_work\tstatus_reply\tnote_steer_calls\tnote_stop_calls\ttimed_out"]
const sec = (ms: number | null | undefined) => (ms === null || ms === undefined ? "-" : (ms / 1000).toFixed(1))
for (const wording of WORDINGS) {
  if (!ONLY_WORDING.split(",").includes(wording.tag)) continue
  for (let rep = 1; rep <= REPS; rep++) {
    for (const c of CASES) {
      if (!ONLY.includes(c.id)) continue
      const r = await runCase(c, wording, rep)
      const st = r.status
      const no = r.note
      rows.push([
        wording.tag, rep, r.case, r.name, st?.runningAtSend ?? "-", r.statusSkipped ?? "-", sec(st?.replyMs), st?.steerWorkDuring ?? "-", st?.stopWorkDuring ?? "-",
        JSON.stringify(st?.reply ?? null), no && "steerCalls" in no ? no.steerCalls : "-", no && "stopCalls" in no ? no.stopCalls : "-", r.timedOut,
      ].join("\t"))
      await writeFile(`${DIR}/summary.tsv`, `${rows.join("\n")}\n`)
    }
  }
}
console.log(`wrote ${DIR}/summary.tsv`)
