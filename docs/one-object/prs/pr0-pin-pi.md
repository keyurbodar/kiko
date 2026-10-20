# PR 0: Pin the pi packages and add Dependabot

Branch `deps/pin-pi` from `origin/main`. It doesn't depend on any other PR.

## Draft description

**Pin the pi packages and get weekly update PRs**

Earendil releases `@earendil-works/pi-durable`, `pi-ai` and `chord` together, with the same version on the same day, about every 3 to 5 days so far. Kiko pinned `chord` exactly but let the other two float with `^`. An update could then pull two copies of `chord`, or move one package without the others. Nothing tells us when a new version ships.

This pins all three to the exact same version. It also adds a Dependabot config that opens one grouped PR a week for `@earendil-works/*`. CI then judges each bump. After PR 1 that includes pi-durable's storage conformance suite, run against Kiko's journal storage.

## Scope

1. In every `package.json` that lists them (`apps/server`, `core/agent`, `core/memory`), set `@earendil-works/pi-durable`, `@earendil-works/pi-ai` and `@earendil-works/chord` to the exact version in `bun.lock`, with no `^`.
2. Run `bun install`. `bun.lock` must change only in the specifier lines.
3. Add `.github/dependabot.yml`:
   - ecosystem `bun`, directory `/`, schedule weekly
   - one group, `pi`, with pattern `@earendil-works/*`
   - `open-pull-requests-limit: 2`
   - ignore every other dependency, so this config only tracks pi
4. Add one line to `AGENTS.md` under "Ways to hurt yourself": "Bump `@earendil-works/*` together, to one exact version. A bump must pass the storage conformance suite."

## Gate

- `bun install --frozen-lockfile` passes.
- `bun run check` passes.
- `.github/dependabot.yml` is valid. GitHub shows it under Insights → Dependency graph → Dependabot after merge.

## Out of scope

Upgrading pi to a newer version. That's Dependabot's first PR.
