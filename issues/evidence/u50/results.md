# U50 results: lead routing and status handling

Source: `spike.ts` against `http://localhost:8850` (wrangler dev, own session). Every number comes from the per-case files in `run1/` and `run2/` (`case-NN.json` for results, `case-NN.frames.json` for statuses and worker snapshots). Tool counts come from the dev stats counters (`tool.talker.*`, `tool.worker.*`), not from model prose. Times are seconds from the send.

## Status of the runs

- **Run1: complete**, cases 1–10. Log: `run1.log`, `run1/summary.tsv`.
- **Run2: complete**, cases 1–10, in three passes. Case 1–4 from the first pass, cases 5–7 from the retry (`run2-retry-attempt2-partial.log`), cases 8–10 from `run2-retry2.log`. Per-case JSON is in `run2/`. Logs of the failed attempts are kept: `run2-attempt1-load-failure.log`, `run2-attempt2-load-failure.log`, `run2-retry-attempt1-load-failure.log`.
- Load: the machine was saturated by other sessions (load average 34 to 44 on 4 CPUs). Failures were load-caused under STANDING rule 10, not app failures: 5 s client timeouts in `devSession` and in `newRoom`, and once a dropped internal connection on a file upload (`Network connection lost` in `server.log`, server kept running). Each failure was rerun from the failing case.

## Table, run1 (complete)

| # | Request | start_work | Talker tool calls | Worker tool calls | Model turns | First reply | Done | Status reply | Status window: talker tools | Status window: worker tools | Note | Steer | Stop | Workers at end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | rename a file | 0 | 1 (mv) | 0 | 2 | 4.9 | 12.3 | - | - | - | - | - | - | none |
| 2 | fix one typo | 0 | 2 | 0 | 3 | 4.9 | 13.5 | - | - | - | - | - | - | none |
| 3 | factual question | 0 | 1 | 0 | 2 | 4.6 | 12.0 | - | - | - | - | - | - | none |
| 4 | add a line to 3 files | 0 | 2 | 0 | 3 | 4.6 | 13.6 | - | - | - | - | - | - | none |
| 5 | 600 word draft | 0 | 7 | 0 | 9 | 21.5 | 45.0 | 16.3 | write 1 | none | no running worker | - | - | none |
| 6 | summarize five files | 0 | 7 | 0 | 4 | 4.6 | 14.7 | 0.9 | read 5 | none | no running worker | - | - | none |
| 7 | web research and report | 1 | 2 | 3 | 7 | 5.1 | 24.8 | 5.4 | none | web_fetch 3 | no running worker | - | - | w1 done, delivered |
| 8 | restructure folder | 0 | 2 | 0 | 4 | 2.8 | 12.8 | 2.3 | none | none | no running worker | - | - | none |
| 9 | "bigger than it looks" | 0 | 3 | 0 | 4 | 3.1 | 15.1 | 1.1 | bash 1 | none | no running worker | - | - | none |
| 10 | burst: small + large | 1 | 4 | 3 | 12 | 3.9 | 233.8 | 2.0 | edit 1 | mkdir 1 | sent at 12.9 s, 1 worker running | 1 | 0 | w1 done, delivered |

Notes on the table:

- "Status window" counts are the counter difference between sending the status and the first status reply. They include the lead's own run continuing, so they show what the lead did during the window, not what the status message caused.
- Case 10 "Stop" is `0`. The script printed `NaN` in `run1/summary.tsv` because the counter key was missing. The fix is in `spike.ts` (missing keys now count as 0). The raw `case-10.json` has `"stopCalls": null` for the same reason.
- Tokens: the dev stats do not expose token counts. `model.turns` is shared by the lead and workers, so the split is not measured.
- Tool rounds: the table uses talker tool calls as the proxy. There is no per-run round counter in the stats.

## Table, run2 (complete)

| # | Request | start_work | Talker tool calls | Worker tool calls | Model turns | First reply | Done | Status reply | Status window: talker tools | Status window: worker tools | Note | Steer | Stop | Workers at end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | rename a file | 0 | 1 | 0 | 2 | 4.6 | 12.0 | - | - | - | - | - | - | none |
| 2 | fix one typo | 0 | 2 | 0 | 3 | 2.7 | 13.2 | - | - | - | - | - | - | none |
| 3 | factual question | 0 | 1 | 0 | 2 | 4.8 | 35.3 | - | - | - | - | - | - | none |
| 4 | add a line to 3 files | 0 | 2 | 0 | 3 | 5.2 | 30.1 | - | - | - | - | - | - | none |
| 5 | 600 word draft | 0 | 5 | 0 | 7 | 19.3 | 39.1 | 14.1 | write 1 | none | no running worker | - | - | none |
| 6 | summarize five files | 0 | 7 | 0 | 4 | 4.7 | 18.6 | 2.4 | read 5 | none | no running worker | - | - | none |
| 7 | web research and report | 1 | 1 | 5 | 7 | 3.3 | 21.4 | 4.3 | none | web_fetch 4 | no running worker | - | - | w1 done, delivered |
| 8 | restructure folder | 0 | 2 | 0 | 3 | 23.4 | 34.0 | 4.0 | bash 1 | none | no running worker | - | - | none |
| 9 | "bigger than it looks" | 0 | 2 | 0 | 4 | 2.5 | 12.2 | 2.0 | none | none | no running worker | - | - | none |
| 10 | burst: small + large | 1 | 5 | 3 | 12 | 4.0 | 26.5 | 2.0 | edit 1 | web_fetch 1 | sent at 12.5 s, 1 worker running | 1 | 0 | w1 done, delivered |

Notes on run2:

- Run2 case 1 earlier had a first reply of 68.8 s in the aborted first attempt. That attempt is not in the table.
- Cases 3 and 4 took 30 to 35 s to done against 12 to 14 s in run1. The machine load (34 to 44) explains it. Run2 cases 5–10 ran at load 10 to 24, so their timings are closer to run1.
- The run2 case 10 counts (5 talker calls, 3 worker calls) differ from run1 (4 and 3). The status window also caught a different worker tool (`web_fetch` in run2, `mkdir` in run1). The runs are not identical; the lead's choices vary from run to run.

## Verdicts

### 1. Does the lead judge small versus slow work well?

Partly. In run1 the lead called `start_work` in only two cases: case 7 (web research, which needs a worker by design) and case 10 (the large half of the burst). Both are right.

- The other eight requests were done by the lead itself with 1 to 7 tool calls. Done times were 12 to 45 s. Case 5 (600 word draft) and case 6 (summarize five files) took 45 s and 15 s, and both were done without a worker.
- **Misjudgment to weigh, case 5.** The lead wrote a 600 word draft itself with 7 tool calls, 9 model turns, and 45 s to done, instead of starting a worker. The brief expected this to be slow work. The owner's design (no thresholds, model decides) allows it, so this is a judgment call, not a clear error. It did keep the lead busy for the whole run, which is what a worker is for.
- Case 9 ("bigger than it looks"): the lead handled it in 3 tool calls and 15 s. That looks right.
- No request was sent to a worker that the lead should have done itself, and no worker-needed request (web) was done by the lead.

### 2. Is status answered fast without touching the work?

Fast: yes. Status replies came back in 0.9 to 16.3 s. Case 5's 16.3 s was while the lead was writing.

Without touching the work: yes. No status window in run1 has a `steer_work` or `stop_work` call. The worker kept running and delivered in case 10.

Answered from worker state: mostly no.

- Case 7: "Research is still running. I will send the short report..." This names real worker state.
- Case 8 and case 9: the status reply talked about the lead's own run ("That search didn't work, so I'll try another way"; "Done. Each file now lives in its own folder...").
- Case 6: "Located five files. I'll read them now to write summaries." This is the lead's own progress, with no worker involved.
- Case 10: the status reply was "Adding that header now." That was the small task. The research worker was running and was not named until a later bubble ("Running: test runner research (worker w1)").

So status got a fast answer, but usually one about the lead's current task, not the worker. The status probe does not disturb the work. It just does not report the worker.

### 3. Do notes reach the worker?

Yes, in both cases tested (run1 and run2 case 10). Run1 case 10's note ("one note: keep it short") caused one `steer_work` call. The worker had been running, and the lead replied "Noted, I'll tell the worker to keep it short." The final report compared three test runners in a short paragraph, which is consistent with the note. This is a single sample, so it is weak evidence. Cases 5 to 9 had no running worker when the note was due, so the note was skipped there (the lead did not need a worker).

## Misjudgments named, with request and what the lead did

- Case 5, "600 word draft": the lead wrote it itself. 7 tool calls, 45 s. Possibly should have used a worker. Judgment call.
- Case 10, status: "what is the status?" got "Adding that header now." The lead answered about the small task. It should have named worker w1 and its step.
- Cases 6, 8, 9, status: the lead answered with its own progress. The status probe during these runs had no worker to report on.

## Fix needed (not implemented)

- **Prompt wording in `WORK_LINES`** (`apps/server/src/agent/prompt.ts`), first choice. Add one line: when the human asks for status, answer from the workers listed in `<context>`, naming each worker and its step. If none is running, say the lead is doing the work itself. This fixes the case 10 answer and the case 7 style reply everywhere.
- **Tool description** is not the gap: the status question does not call a tool.
- **Structural gap**: the lead has no status channel that is separate from its current run. It answers from whatever it is doing. This is the cause of the "Adding that header now" answer. If prompt wording does not fix it, add a status line to the context (the `note()` output already exists) and check it on each reply.

### Run2 confirms run1

- Routing: run2 used a worker in the same two cases (7 and 10), and handled the rest itself.
- Status: run2 status replies were the lead's own task in cases 5, 6, 8, and 10 ("Got it, I'll create a subfolder per project file"; "File read done, now adding the header"). Case 7 named the running worker. No status window in run2 has a `steer_work` or `stop_work`.
- Notes: run2 case 10 again caused one `steer_work`, and the worker's final report was short (130 words, against "short" requested). Two note samples now: both reached a worker. Neither shows the outcome changed in a measurable way.
- Case 9 judgment: the lead changed "Acme" to "Initech" in five files and left `hi@acme.example` unchanged. The status reply said "Done. Changed Acme to Initech in 5 files." That is an honest report of what it did, but the lowercase domain in the email was a judgment call the human might not have wanted. It is a misjudgment only if the human meant every mention.

## Follow-ups

- A third note sample would strengthen the note verdict. Two samples exist, both from the burst case with a worker.
- The fix in `WORK_LINES` should be tested by rerunning the status probes once the wording changes. This spike does not change product code.
