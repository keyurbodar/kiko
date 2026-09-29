# The Solid port

Kiko's frontend is being rewritten, not ported. The old React app stays at
`apps/web` until the Solid one is further along; it is reference, not
inspiration. Read this instead of having the port explained again.

## Where things are

```
apps/web-solid/           the rewrite, and the only app we build in
  src/lib/                types, fixtures, store — the frozen contract
  src/<slice>/            one directory per slice, one owner each
  OWNERSHIP.md            who writes what
packages/ui/              @kiko/ui, the design system
  src/theme/              the opencode theme engine, unmodified
  src/app-theme/          the T3 role layer, unmodified
  src/v2/                 the opencode v2 components, unmodified
  src/styles/kiko.css     the Kiko token bridge — ours
docs/                     this, plan, tech-stack
```

`apps/web` is frozen. Its source is stale on purpose: it still imports the
banned packages, because removing them was a manifest change and nothing else.
It is not a reference for how to write new code.

## What changed, and why

**Framework.** `react`/`react-dom` → `solid-js`, `@vitejs/plugin-react` →
`vite-plugin-solid`. Solid's fine-grained reactivity removes the re-render
problem the old app was careful about, but it does not remove the discipline —
see "what does not change".

**Components.** `@base-ui/react` → `@kobalte/core`. Both are headless. The
opencode v2 set in `packages/ui/src/v2` is Kobalte-based already and is the
source we draw from.

**State.** `zustand` → `solid-js/store`. `@effect/atom-react` and `effect` are
gone: the effect runtime was banned client-side for weight (208.5 raw /
69 gzip KiB) and nothing in the renderer used it.

**Editor.** The whole `@tiptap/*` stack is gone — seven packages, and the
largest single saving in the port. Opencode's composer is a raw contenteditable
plus about 150 lines of its own; Kiko v1 excludes attachments, markdown and
code blocks anyway, so a controlled textarea is the honest size.

**Markdown.** `react-markdown` is gone. v1 renders no markdown at all
(`docs/plan.md:49-50`), so pulling in a parser would be shipping a dependency
for a feature the plan excludes.

**Icons.** `lucide-react` → the opencode Icon sprite in `@kiko/ui/v2`.

**Formatter.** `prettier` removed from the app; it was a runtime dependency
where formatters belong to the toolchain.

Kept: `blobatar`, `date-fns`, `sugar-high`, `remark-gfm`, `remark-breaks`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `@tailwindcss/vite`.

## Net effect

The React client measured about 445 gzip KiB. Removing tiptap and the effect
runtime lands the Solid client near 160-170 gzip KiB — roughly 60% off, and the
editor stack alone outweighs the entire framework swap.

## Theming

Three layers, and the order is the whole point.

1. **`packages/ui/src/theme/`** — the opencode engine. Emits
   `--text-weak`, `--background-base` and friends. Unmodified upstream copy.
2. **`packages/ui/src/app-theme/`** — the T3 role layer. Takes a theme JSON,
   resolves 57 role names against user settings, and writes `--kiko-*` vars.
   Also unmodified; the two names coexist deliberately, since the v2 components
   still need the v1 set.
3. **`packages/ui/src/styles/kiko.css`** — ours. The bridge: one `--radius`
   base with a `calc()` ladder, dense type steps, and `@theme inline`
   registration of the role vars as Tailwind utilities.

Import order matters, and it is the reverse of what the layers suggest:

```css
@import "tailwindcss";
@import "@kiko/ui/theme.css";
@import "@kiko/ui/v2/styles/tailwind.css";
@import "@kiko/ui/kiko.css";
```

Slices write `class="bg-sidebar text-foreground rounded-lg"`, never
`var(--kiko-sidebar)`. A theme swap then repaints the app with no stylesheet
change, which is the point of the layer.

Two traps worth knowing before they bite:

- `text-*` is one namespace for both font-size and colour. A colour named
  `--color-text-muted` silently turns `text-code` into a background. Ours is
  `--color-weak`, and a new colour has to be checked against the size names
  first.
- The radius ladder is unlayered in `:root` and must stay that way. `@theme`
  lands in Tailwind's theme layer, and unlayered declarations beat layered ones
  regardless of source order — `theme.css`'s flat values would win otherwise.

## The slices

`chat`, `composer`, `sidebar`. One git worktree each, one directory each, one
CSS file each. They run side by side against the frozen contract in
`src/lib/types.ts` and share nothing else. `apps/web-solid/OWNERSHIP.md` is the
authority; `src/main.tsx` is the one file nobody edits while they run.

A slice that finds a type wrong changes it on `main` and lets the others pull.
Three divergent contracts is the same dropped-work failure as an unowned file.

## What does not change

The product rules in `AGENTS.md` were written for the React app and they still
hold. Bubbles only. Instant, always. Nothing blocks anything else. One owner per
live value. Tokens over literals.

The one that changes shape is re-rendering. Solid's reactivity is fine-grained
enough that a store write touches only the DOM nodes that read it, which
removes the class of bug the old app was defending against. It does not license
a timer at the top of the tree: a `createSignal` still repaints whatever reads
it, and a ticking clock in a parent is still a screenful a tick.
