# U64 results: status answers while a worker runs

Source: `spike.ts` in this folder, run against wrangler dev on port 8864 in this worktree, with dev keys from `apps/server/.dev.vars` and the real model through `connectTestModel`. Cases 7 (web research) and 10 (burst: a small edit plus web research). Each wording was sent three times per case, so 12 trials per run. Two runs:

- `run1`: the U54 line, `On "how is it going?", cover everything in progress ...`.
- `run2`: the generalized line, `When the human asks for status or progress, cover everything in progress ...`. This is step 6 of U64.

Every trial sent its question with one worker running (`runningAtSend` 1 in all 24). No trial was skipped, and every trial finished with `timed_out` false.

## Method change from U54

The spike now sends the question only after a fresh read of the room's workers shows one `running`. U54 sent four seconds after the lead first showed `typing`, before a worker existed in 6 of 6 case-10 runs.

## How the strict count was judged

The spike's `status.reply` field takes the first lead message after the send. That field is wrong for this design. In most trials that first message still answers the task message, not the status question. So each trial was judged by hand from the timestamped `replies` list in its JSON. The judged message is the first post-send lead message that reports status. Its text, time, and judgments are in the table below, which was generated from the JSON by substring. Nothing was retyped.

Rules applied to the judged message:

- **Names running work.** It says a background task is running.
- **Names the worker.** It uses the worker id (`w1`) or the word "worker".
- **Gives its step.** It says what the worker is doing now: a source, a page, a file, or an action in progress. A restatement of the task ("researching the top open source vector databases") does not count.
- **Strict.** Names the worker AND gives its step. This is the brief's definition.

## Counts

| Run | Wording | Names running work | Names the worker | Strict (worker and step) |
|---|---|---|---|---|
| run1 (U54 line) | what is the status? | 6 of 6 | 5 of 6 | **2 of 6** |
| run1 (U54 line) | how is it going? | 6 of 6 | 6 of 6 | **4 of 6** |
| run2 (generalized line) | what is the status? | 6 of 6 | 6 of 6 | **4 of 6** |
| run2 (generalized line) | how is it going? | 6 of 6 | 3 of 6 | **2 of 6** |

Both wordings are under 5 of 6 in both runs. Across all 12 strict judgments, the count is 6 of 12 before the line change and 6 of 12 after. The change moved the misses from one wording to the other. It did not raise the total. With six trials per cell, these differences are within noise.

Where the misses come from, from the judged messages: most strict misses name the worker and then restate its task, with no current step. Some name only the research, with no worker. None of the misses comes from a missing phrase. The line now covers both wordings, but the lead still does not report a step.

## Steer and stop calls

- The status window in the JSON covers only the time from the send to the first post-send message. That window can end before the status answer, so its counts are not evidence about the answer. Do not read them as a result.
- Whole-trial totals: `tool.talker.steer_work` ran in 14 of the 24 trials. `tool.talker.stop_work` ran in none.
- The spike sends a human note ("do it fast" or "keep it short") 5 seconds after the status reply. That note is itself a steer request. Most steers are probably the lead answering the note. The data do not show when each steer ran, so attribution to the status question is UNVERIFIED.

## Verbatim judged replies

Columns: run, wording, rep, case, workers running at send, milliseconds from send to the judged message, names running work, names the worker, gives its step, strict, verbatim text. Ms is measured from the send.

| run | wording | rep | case | running at send | ms after send | names running | names worker | gives step | strict | verbatim |
|---|---|---|---|---|---|---|---|---|---|---|
| run1 | status | 1 | 07 | 1 | 7661 | Y | Y | Y | **yes** | Research in progress. - **w1:** fetching DB-Engines vector ranking to pick top three, then writes report to research/vectors.md.  |
| run1 | status | 1 | 10 | 1 | 7035 | Y | N | Y | **no** | Done: notes/todo.md now starts with Reviewed. In progress: test runner research (comparing Jest, Vitest, Mocha trends). I will post the file when ready.  |
| run1 | status | 2 | 07 | 1 | 6429 | Y | Y | N | **no** | Research is running. Worker **w1** is gathering the top three open source vector DBs, features, and sources. I will write `research/vectors.md` when it reports back.  |
| run1 | status | 2 | 10 | 1 | 8793 | Y | Y | N | **no** | 1. `notes/todo.md` update is done. 2. Test runner research (w1) is still running. I will post the comparison when it finishes.  |
| run1 | status | 3 | 07 | 1 | 6944 | Y | Y | N | **no** | Research is in progress. - Me: waiting on the research to write the report. - Worker w1: running, finding the top 3 open source vector DBs and drafting `research/vectors.md`.  |
| run1 | status | 3 | 10 | 1 | 9202 | Y | Y | Y | **yes** | Small task done: `notes/todo.md` now starts with **Reviewed**. Large task in progress: worker is researching test runners and writing `research/tests.md`. Current step is checking files.  |
| run1 | going | 1 | 07 | 1 | 6556 | Y | Y | Y | **yes** | Worker is still running. It made the research folder and now gathers data on the three vector databases. I will post the report when it is done.  |
| run1 | going | 1 | 10 | 1 | 8799 | Y | Y | N | **no** | Quick task done: **Reviewed** is at the top of notes/todo.md. Large task in progress: worker w1 is researching test runners and writing research/tests.md. Not done yet.  |
| run1 | going | 2 | 07 | 1 | 8635 | Y | Y | Y | **yes** | Research is running. Worker is checking source pages now. I will share the report in `research/vectors.md` when it is done.  |
| run1 | going | 2 | 10 | 1 | 8579 | Y | Y | Y | **yes** | notes/todo.md is done. Reviewed is at the top. w1 research is running. It is setting up research/tests.md now.  |
| run1 | going | 3 | 07 | 1 | 6205 | Y | Y | Y | **yes** | Research is in progress. Worker w1 is checking sources now. I will write the report when it returns.  |
| run1 | going | 3 | 10 | 1 | 8898 | Y | Y | N | **no** | `notes/todo.md` is updated. Research worker `w1` is still running. It will write the comparison to `research/tests.md`.  |
| run2 | status | 1 | 07 | 1 | 6536 | Y | Y | Y | **yes** | w1 is running. It is checking Milvus on GitHub now, then it will write the report to `research/vectors.md`.  |
| run2 | status | 1 | 10 | 1 | 6527 | Y | Y | N | **no** | Done: **notes/todo.md** now starts with Reviewed. Running: research worker w1 is still working on **research/tests.md**. I will post the comparison when it lands.  |
| run2 | status | 2 | 07 | 1 | 6356 | Y | Y | N | **no** | Worker **w1** is still running. It is researching the top open source vector databases and will write the report to `research/vectors.md`. No result yet. I will send it when it lands.  |
| run2 | status | 2 | 10 | 1 | 7143 | Y | Y | Y | **yes** | notes/todo.md is done. Research worker w1 is still running: it is comparing the three test runners and will write research/tests.md.  |
| run2 | status | 3 | 07 | 1 | 12874 | Y | Y | Y | **yes** | Research is running. - Me: waiting on the research worker. - Worker w1: checking sources, now on Chroma GitHub page. Report will go to `research/vectors.md` when done.  |
| run2 | status | 3 | 10 | 1 | 8506 | Y | Y | Y | **yes** | notes/todo.md is done. w1 is running: researching JS test runners, now checking State of JS results.  |
| run2 | going | 1 | 07 | 1 | 11345 | Y | N | N | **no** | Research is running. I am checking the top open source vector databases now. I will write the report to research/vectors.md when the facts return.  |
| run2 | going | 1 | 10 | 1 | 6403 | Y | Y | N | **no** | Done: **notes/todo.md** now starts with Reviewed. Running: test runner research (worker w1) is still going. I will share research/tests.md when it lands.  |
| run2 | going | 2 | 07 | 1 | 6533 | Y | Y | Y | **yes** | Research is running. Worker is now checking Chroma page after Milvus and others. I will share the report in `research/vectors.md` when done.  |
| run2 | going | 2 | 10 | 1 | 9559 | Y | N | N | **no** | notes/todo.md is done. Research is still running, now checking download trends for Jest vs Vitest vs Mocha. I will send the file when it is ready.  |
| run2 | going | 3 | 07 | 1 | 6517 | Y | N | N | **no** | Research is running. It is now checking DB-Engines ranking to confirm the top three. I will post the report in `research/vectors.md` once it is done.  |
| run2 | going | 3 | 10 | 1 | 7132 | Y | Y | Y | **yes** | Small task done: `notes/todo.md` now starts with Reviewed. Large task still running: research worker on test runners is gathering data and will write `research/tests.md`. No result yet.  |

## Follow-ups

- The spike's `status.reply` field should take the status answer, not the first message after send. The protocol does not tag which message answers which question, so this needs either a fixed window after the question or a reply-matching rule. Not fixed in U64.
- The status window for steer and stop counts should end at the judged answer, not at the first message.
- The lead rarely reports a step for the worker. Whether a stronger prompt line helps is UNVERIFIED; this run only shows the one-line change does not move the total.
