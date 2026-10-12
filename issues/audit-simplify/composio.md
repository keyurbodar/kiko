# Composio, keys, provider login, model wiring (Haiku, read-only)
About 172 lines across 21 items, plus about 46 lines to move behind dev-guard (the fake sign-in provider and dev counters are in the production bundle).
Top: key rotation leftovers 22 (decided); 40-call limiter 21 (medium-low, keep withRetry); SSE parsing 15 (UNVERIFIED; Connect endpoint does answer with SSE, so keep); login timeout alarm 15 (in-memory map, alarm finds nothing after eviction); ck_ path 12 (KEEP: owner's Gmail); name dedupe 10; login small cuts 10; listing cached twice 8; per-user AAD 8 (decided); duplicate validation 7; two talker/worker tool lists 6; PROVIDER_OAUTH gate 6; limits in turn context 5 (decided); about 15 smaller.
DO: MODEL_APPLIED_KEY is a second row for one fact.
