# Experiments that run alongside PR 2

Each experiment is small and throwaway, and its answer decides a later PR. None of them touches the files PR 2 is moving. Run them as children of the PR 2 orchestrator, on the medium route (`opencode`, `amr-link/deepseek-v4.1-flash`).

Each one reports its answer, with the numbers and the script, in a short note in `docs/one-object/evidence/`.

## A. Does a self-call get fresh limits? (decides PR 5)

Build a scratch Worker with one Durable Object, outside the Kiko app, on the free plan account or in local `wrangler dev`.

1. The object calls its own stub 3 times in parallel. Each call makes 45 outgoing `fetch` requests to a cheap endpoint.
2. Record whether any call hits the 50-subrequest limit, and whether each call reports its own CPU time.
3. Repeat with 3 calls started from one alarm instead.

**Answer:** yes or no, with the output. If it's no, PR 5 starts each run from the alarm.

## B. R2 archive module (wired in by PR 6)

Write `owner/archive.ts` as a pure module, with no Kiko imports:
- `writeDay(bucket, roomId, day, rows)` writes gzip JSONL with `CompressionStream`.
- `readDay(bucket, roomId, day)` returns the rows.
- `listDays(bucket, roomId)` lists the archived days.

Test a round trip against Miniflare's R2. Check that the same day written twice gives one object, and that a day with 5,000 messages fits within a 30 s CPU budget.

## C. What does an FTS5 insert cost? (decides PR 4)

In a Durable Object, create `messages` with an FTS5 external-content table, using today's definition. Then measure the rows written, via `rowsWritten`, for:
1. inserting one 200-character message
2. inserting the 5 replies of one run in one transaction
3. updating one message's text
4. the same three cases with `columnsize=0` and `detail=none`

**Answer:** a table of rows per case, and the cheapest definition that still supports Kiko's search, which needs prefix match, snippets and deleted messages hidden.
