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
