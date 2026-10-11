# U41 Close: enforce every rule, docs match code

**Model** Sonnet 5.5 medium. **Wave** 5. **Depends on** everything else. **Timebox** 2 h.

## Goal
Flip every remaining `check-rules` rule to enforce (each leftover site gets a real reason or is fixed). `docs/architecture.md` and `AGENTS.md` match the code: gen-catalog path, removed systems, the egress decision, every DEVIATION labeled, UNVERIFIED labels removed where this program settled them. `bun run check` and `bun yuki verify --no-model` green on `main`.
