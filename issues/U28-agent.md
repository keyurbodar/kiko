# U28 Agent: the human can stop work, and ask does not hold the object

**Model** Opus 5.5 medium. **Wave** 3. **Depends on** U05 report, U01. **Port** 8828. **Timebox** 3 h.

## Goal
Apply the U05 answers. The brief is completed from the U05 report before spawn.

## Also
`core/agent/src/host.ts:393-396` sets `steered=1` before submit; swap the order. `core/agent/src/inbox.ts:206-207` puts slug and reason into XML attributes unescaped; escape them. `apps/server/src/agent/extensions/spill.ts:33-40` re-encodes per line (quadratic); keep a running byte count.
