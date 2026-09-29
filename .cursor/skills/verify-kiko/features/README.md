# Kiko verification map

This directory is the maintained source for verifying the user-facing behavior of Kiko. Read the index before driving the app, then use the matching feature file as the recipe.

The map reflects what exists **today**. The chat transcript has landed; the roster sidebar, the composer, and the top bar's conversation controls have not, and the gap is recorded under [Known gaps](#known-gaps) instead of being papered over with invented recipes.

## Baseline preconditions

- Launch the dev server per `../SKILL.md` **Launch** and keep `/tmp/kiko-verify-evidence/vite.pid` in place.
- Port 3001 unless a sibling Kiko checkout already owns it; then a free port, used consistently in every later step.
- `../SKILL.md` **Doctor** reports `ok: true`.
- Never drive an instance this run did not start. A port that answers but is not owned by your pid is another checkout's app.

## Driving conventions

- The harness is `ego-browser nodejs`. There is no Playwright and no Puppeteer here; a script that imports `chromium` from Playwright fails.
- One TaskSpace per goal. Print `space.id` and pass it back via `await taskSpace(<id>)` in later rounds; every invocation is a fresh Node process.
- Page globals do not exist in the Node script. Put `window`/`document` access inside `page.evaluate()`.
- Prefer data attributes over CSS layout selectors: `loc=css:html[data-theme-id="whirl"]`, `loc=css:#root`.
- Treat every command as literal. Keep the port and paths exactly as written.
- Do not edit a source file to make an assertion pass. A failing check is a finding to report.

## Proof and skip reporting

- Evidence goes to `/tmp/kiko-verify-evidence/`, and it must still be there after cleanup.
- Capture the action and the resulting state, not only a final screenshot.
- Assert from the script's own output — the `console.log` value is the doc.
- Record the port, the feature id, and the entry point with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with ego-browser` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Whirl theme tokens](./theme-tokens.md) covers the palette Kiko paints onto the page at load, the dark appearance, and the token layer every slice styles against.
- [App shell](./app-shell.md) covers the mounted page: title, root element, and the provider tree the UI renders into.
- [Chat transcript](./chat-transcript.md) covers the message column: runs, day dividers, reactions, inline replies, the hover action cluster, copy, the jump pill, the waiting row, and virtualization.

## Known gaps

**The roster sidebar, the composer, and the top bar's conversation controls do not exist yet and are deliberately not mapped.** `apps/web-solid/src/main.tsx` renders a top bar carrying a conversation title and a row of switcher buttons, then the transcript. The switcher is scaffolding that stands in until the sidebar lands, and it is not a feature worth a recipe.

The fixture data behind the transcript is worth knowing before extending it: `apps/web-solid/src/lib/fixtures.ts` holds 61 messages across 5 conversations spanning 4 calendar days, with 20 reactions and 5 inline replies. Bot ids are `ada`, `grace`, `alan`, `katherine`; the group id is `launch`; the viewer id is `viewer`. No bot id collides. Generated message ids take the form `sent-N`.

The data deliberately includes consecutive same-author bursts, because a transcript that only ever alternates one message for one reply never exercises the collapse that makes the layout worth building. Every conversation carries at least one run, and `ada` carries a message eleven minutes after its predecessor to prove the ten-minute window ends a run.

**Three built components are mounted nowhere and cannot be reached, so they have no recipes.** `ui/Skeleton.tsx` and `ui/ErrorState.tsx` need an async state that v1 has no source for, and `lib/useLoadEarlier.ts` needs older pages that the fixtures do not contain. Do not write a recipe that reaches them through another path, and do not record them as verified.
