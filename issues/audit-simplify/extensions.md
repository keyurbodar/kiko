# Extensions and sandbox (Haiku, read-only)
About 502 lines: 371 are the generated catalog copy (catalog.gen.ts plus gen-catalog.ts and its freshness test, replaced by a runtime import; UNVERIFIED that wrangler text imports work), about 131 hand-written.
Top: catalog copy 371 (medium); ext-bundle storage cache and prefix scan 14 (medium); key encryption removal 16 (decided); one runScript helper in compile.ts 14 (low); homeOrThrow 6; builder preamble 6; vm describe/errorText 7; plus about 25 small collapses and impossible-state guards.
DO reads and writes: live() reads and parses the full bundle on every state or fetch call (cache the manifest by hash); a broken extension re-runs the whole sync and an extensionError RPC on every run; bundle prefix scan on change; secret scrubbing decrypts every secret per response; N+1 in list and proposals.
Keep: VM budgets and limits, state caps, trigger chain serialization, talker/worker split.
