# U35 Record engagement only when the human actually engaged with a nudge

**Model** Opus 5.5 medium. **Wave** 4. **Depends on** U40b (done). **Port** 8835. **Timebox** 3 h.

## The problem (measured)
Today any human message in the nudge's chat before the ignore deadline counts as engagement. The U40b simulation (`issues/evidence/u40b/signal.ts`) shows a nudge the human meant to ignore is recorded as engaged 66 to 99 percent of the time with one chat, 57 to 78 with three, 44 to 62 with eight. Both the per-user and per-kind appetite learn from this signal, so they mostly learn noise.

## Goal
Design and implement the smallest signal that tells "the human responded to this nudge" from "the human was in the chat anyway". Read `apps/server/src/initiative/engine.ts`, `attention/store.ts`, `attention/appetite.ts`, `attention/attend.ts`, and how nudges are posted and settled. Candidate evidence, cheapest first: the human replies to the nudge bubble (reply quote); the nudged loop changes state (closed, snoozed, done, edited) before the deadline; the agent's next run, which already reads the human's message, marks whether it answered the nudge (only if it costs no extra model call). Pick from evidence, not taste, and keep it one rule.

Then rerun `issues/evidence/u40b/kindsplit.ts` and `analyze.ts appetite` with the new signal modeled, and decide per-kind appetite: keep it if it now separates outcomes beyond noise for realistic users, otherwise replace it with one per-user Beta exactly as the U40b report describes (`appetite.ts` kinds, `kindMean`, `kindOpen`, kind weights, the kind half of `learn`, `attend.ts` kind use, `AttentionStore.skipped`). State the numbers either way.

## Not in scope
`rhythm.ts` and the `score` function (U34 owns them).

## Acceptance
- A test that fails today: a human who sends unrelated messages in the chat after an ignored nudge does not record engagement; a reply to the nudge does.
- The simulation numbers before and after for `signal.ts` and `kindsplit.ts`, pasted.
- `bun run check` passes. `bun yuki verify initiative initiative-loops proactive --url http://localhost:8835` with the dev keys pass on your own server (follow `.cursor/skills/verify-initiative/SKILL.md`).

## Report

**Rule.** A nudge is engaged only when the human answers it. Three things count as an answer, all inside the window from the nudge to its ignore deadline: a human message that quotes one of the nudge's bubbles; a burst that touches the nudged loop (the two-shared-words touch the engine already did); or, with a judge key, a burst Jev judges an answer to the nudge's last bubble. Jev gets one more bool question per pending nudge in that chat, inside the burst call it already makes, so there is no extra model call. It also judges replies shorter than the loop sentences' 8 characters ("not yet"). A human who talks in the chat about something else has not engaged. Dismissal is unchanged.

**Why this design and not reply quote alone (evidence).** The simulation got a `RECALL` knob: the share of meant replies the server recognises. Nudges per persona at 3 rooms over 10 seeds x 8 weeks (meant-reply + meant-ignore + meant-stop, from `signal.ts`):

| | before (any message) | recall 1 | recall 0.6 | recall 0.3 |
| --- | --- | --- | --- | --- |
| regular-keen | 279 | 270 | 192 | 117 |
| regular-ignorer | 262 | 91 | 85 | 81 |
| hoarder | 667 | 333 | 229 | 141 |

At recall 0.3, which is about what a reply quote alone would catch, keen users lose 58 percent of their nudges and look like ignorers. Recall decides the outcome, so the rule reads content through Jev and keeps the quote as the path that needs no judge. ASSUMPTION: Jev's recall is about 0.8. UNVERIFIED on real traffic.

**signal.ts, recorded engaged among meant-ignore, before -> after (recall 0.8)** (`out-u35-signal-room.txt` reproduces `out-*` exactly; `out-u35-signal-r08.txt`):

Personas in order: regular-keen, regular-ignorer, irregular-keen, irregular-ignorer, kind-split, weekday-weekend, hoarder.

- 1 room: 93/98/66/81/99/99/96% -> 20/16/12/5/26/13/29%
- 3 rooms: 72/76/60/57/71/78/72% -> 14/7/2/4/9/11/9%
- 8 rooms: 49/61/44/48/51/62/59% -> 11/9/2/0/6/12/9%
- Meant-reply recorded engaged at 3 rooms, recall 0.8: 57 to 82% (bounded above by the deadline passing before an irregular user's next session, as before).

The leftover false engagements are passing mentions of the item (the sim's 8 percent chance per burst), which really are about the item.

**kindsplit.ts, kind-split persona, 40 seeds, welcome share (per-kind / pooled / none):**

| | before | after, recall 0.8 | after, recall 0.6 |
| --- | --- | --- | --- |
| 3 rooms, no Jev | 51.1±2.4 / 47.6±2.3 / 46.1±2.0 | 62.8±1.9 / 50.7±2.5 / 49.9±1.8 | 62.2±2.1 / 52.7±2.6 / 49.5±1.7 |
| 3 rooms, Jev | 47.1±2.0 / 46.7±2.0 / 47.7±1.9 | 56.2±1.9 / 51.5±2.2 / 52.3±1.7 | 55.9±2.1 / 55.1±2.5 / 52.3±1.7 |
| 8 rooms, no Jev | 52.9±2.4 / 47.0±2.2 / 46.2±2.1 | 62.7±1.8 / 51.9±2.5 / 50.1±1.9 | 62.5±2.1 / 53.4±2.6 / 49.5±1.9 |
| 3 rooms, aware human, no Jev | 33.6±2.1 / 29.4±1.7 / 32.5±1.7 | 47.4±1.9 / 40.7±2.0 / 34.3±1.4 | |
| 3 rooms, aware human, Jev | 29.0±1.8 / 28.6±1.7 / 32.4±1.5 | 40.3±1.8 / 38.9±2.0 / 37.1±1.6 | |

Unwelcome goal, intention, and project nudges at 3 rooms, no Jev: 233 per-kind vs 296 pooled vs 518 none (before: 623 / 691 / 596).

**Per-kind appetite: kept.** Without Jev it now separates outcomes by 4 to 5 standard errors in both human models and at both recalls. With Jev the gap is within noise, but per-kind is never worse than pooled. `analyze.ts appetite` (3 rooms, recall 0.8, `out-u35-appetite-r3-r08.txt`) shows no harm to uniform personas: welcome share per-kind vs pooled is 77.9 vs 79.4 (regular-keen), 7.1 vs 8.3 (regular-ignorer), 40.7 vs 38.8 (hoarder), and kind-split 66.2 vs 61.0. Having no appetite at all sends ignorers 2 to 3 times more nudges (85 -> 231 for regular-ignorer). Nothing was deleted.

**Plumbing.** The room puts `answers` (the quoted initiative bubble's seq) on a human burst signal, and `text` (the last bubble, at most 500 characters) on a run's `routine_result`. `Pending` keeps `seq` and `what`. Human task changes no longer go to `UserDO` unless a routine matches them, because the engine no longer reads them. `lastAgentSeq` became `lastAgentMessage`. Architecture 25.4 and 26.6 are updated.

**Failed before.** On the old `apps/server/src` with the new tests:
- `(fail) a human who chats about other things after a nudge did not engage with it; a reply quoting it did` (initiative-runs.test.ts)
- `(fail) appetite > an answer to the nudge is engagement at the deadline; talking in its chat anyway is not` (attention.test.ts)

**Verified.**
- `bun run check`: all 10 steps passed (frontend lint is advisory, 17 errors that were already there).
- `bun run --cwd apps/server test -- initiative-runs initiative-safety attention routines`: 66 pass, 0 fail.
- On my own server on port 8835 with dev keys, after merging main: `bun yuki verify proactive`: pass (51 s). `bun yuki verify initiative-loops`: pass (85 s). `bun yuki verify initiative`: pass (559 s, both arms).
- Earlier `initiative-loops` runs failed three times for reasons outside this change. In the no-judge arm the agent did not close the grant loop. In the Jev arm the suite's `/run/` poll matched an explicit "running plan" loop. Once wrangler reloaded mid-run because of my merge and returned 503. No nudge was pending in that suite, so the new Jev question was never asked.

## Discoveries

- `.cursor/skills/verify-initiative/scripts/server.sh start` always runs `bun dev:server`, which hardcodes `--port 8787`. `YUKI_URL` changes only the health check, so on a shared machine it fails with "Address already in use". I started wrangler by hand on 8835.
- `initiative-loops` is flaky with real models. The Jev arm's `/run/` poll can match the explicit "beginner running plan" loop instead of the tentative "start running" one.
- `check-exports` reports that the stale baseline entry `apps/server/src/user/reminders.ts:MAX_FAILS` can be deleted. It is not from this unit.
