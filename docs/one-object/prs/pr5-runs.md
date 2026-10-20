# PR 5: One invocation per run

Branch `one-object/pr5-runs` from `one-object/pr2-owner-do`. It runs at the same time as PR 4.

## Draft description

**Give each run its own invocation limits**

On the free plan, one invocation gets 50 outgoing calls, 6 open connections and 30 s of CPU. With every agent in one object, 20 agents running from one invocation would share those limits. A long tool loop could also reach 50 calls on its own.

This PR starts each run in its own invocation by calling the object's own stub, so every run gets fresh limits. A run that reaches 40 outgoing calls or 12 minutes saves and continues in a new invocation, resuming from the journal. The human sees one uninterrupted run.

## Steps

1. **Use experiment A's result.**
   - If a self-call gets fresh limits, `owner/runs.ts` starts each run with `this.env.OWNER.get(this.ctx.id).run(agent, requestId)`.
   - If it doesn't, each run starts from the alarm, and runs queue on the clock.
2. **Count outgoing calls per run** through `AgentDO.egress`, the single place where outside fetches go, plus model calls.
3. **At 40 calls or 12 minutes,** stop placing new work after the current step, commit, and start the continuation. Pi's recovery path resumes the task.
4. **Show nothing to the human.** No new bubble and no gap in streaming beyond the reconnect.

## Gate

- 20 parallel fake runs of 60 tool calls each finish with no limit error.
- Each run's transcript is identical to a run that wasn't split.
- Rows added per continuation are reported.

## Out of scope

Scheduling policy and routines (PR 3).
