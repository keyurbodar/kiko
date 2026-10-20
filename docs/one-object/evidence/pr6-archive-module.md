# PR 6 archive module

The module reuses experiment B's structural R2 bucket interface, deterministic key layout, gzip JSONL encoding, and cursor traversal. The source experiment is in the PR 2 worktree at `docs/one-object/evidence/experiment-b/archive.ts`. This version makes reads generic and lists newest first. It has no imports, Kiko dependencies, or message schema assumptions.

## API

```ts
writeDay(bucket: ArchiveBucket, roomId: string, day: string, rows: readonly unknown[]): Promise<void>
readDay<T>(bucket: ArchiveBucket, roomId: string, day: string): Promise<T[] | null>
listDays(bucket: ArchiveBucket, roomId: string): Promise<string[]>
```

`ArchiveBucket` structurally requires `put`, `get`, and `list`, so native R2 bindings and Miniflare R2 bindings work directly. Keys are `archive/<roomId>/<YYYY-MM-DD>.jsonl.gz`. Room ids use 1 to 64 ASCII letters, digits, underscores, or hyphens. Days must be real calendar dates in the UTC `YYYY-MM-DD` format.

Each write replaces the whole day at the same key. It preserves input order and JSON-serializable fields, with one JSON value and newline per row. It compresses with `CompressionStream("gzip")`. The module buffers the day's JSONL and compressed bytes. Callers own day assignment and JSON schema validation. JSON serialization semantics apply, including omission of undefined object fields. Undefined rows are rejected.

Reads use `DecompressionStream("gzip")`. A missing key returns `null`; an archived empty array returns `[]`. Corrupt gzip or JSON rejects the read. The generic parameter describes the caller's stored schema without runtime field validation.

Listing follows every R2 cursor, filters unrelated keys and invalid dates, deduplicates days, and returns descending UTC dates. Missing or stationary cursors on truncated pages reject instead of looping indefinitely.

## Reproduction

```sh
TMPDIR=/home/keyur/.cache/kiko-pr6/tmp bun test apps/server/test/archive.test.ts
```

The tests transpile the actual module into a Miniflare Worker and execute write/read through its real R2 binding. They verify full rich payload equality, row order, gzip magic and exact JSONL, overwrite behavior, missing and empty days, room isolation, malformed input and corrupt data. Pagination uses real R2 list calls capped at two objects per page.

The 5,000-message check times one complete local Worker request through write and read, including transport and response decoding. It asserts full payload equality and elapsed wall time below 30 seconds. This is a local wall-time budget check, not a measurement of Cloudflare production CPU accounting. Each generated row includes Unicode text, rich blocks, attachment metadata, nested tool payloads, reply metadata, sequence, timestamp, and a fingerprint.

Runtime is Bun 1.3.14, Miniflare 4.20260730.0, and its bundled workerd with compatibility date 2026-07-01. The host had load average 81.95 on 4 logical CPUs during startup. Startup and disposal have separate 120-second timeouts; the message operation retains its 30-second timeout. The first attempt timed out during Miniflare startup before archive assertions ran.

Validation results will be recorded after the runtime check completes.
