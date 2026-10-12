# U54 status wording

Measures one line of `WORK_LINES` in `apps/server/src/agent/prompt.ts`: a status answer should name each running worker and its step. The runs used the real `opencode-go` model on a wrangler dev server.

Files:

- `results.md`: the verdict, the status replies verbatim, and the counts. Read its Correction section before you quote the verdict. The strict count is 4 of 6 for naming the worker and 2 of 6 for naming the worker and its step.
- `spike.ts`: the driver, a copy of the U50 spike with `BASE` set to port 8854. Its header still names `issues/evidence/u50/spike.ts`, which is not on main.
- `r1/` to `r6/`: one pass each. Every pass has `case-07.json`, `case-10.json`, their `.frames.json` files, and `summary.tsv`.

The line changed after these runs. U64 changed it, and `issues/decisions.tsv` logs that change. The current text is `WORK_LINES` in `apps/server/src/agent/prompt.ts`. The U64 re-measure is logged there too, but its folder is not on main.
