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
  src/v2/                 the opencode v2 components, unmodified
  src/styles/kat.css      the kat token layer — ours, the only theme
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
largest single saving in the port. Its replacement is opencode's v2 prompt
composer, vendored to `apps/web-solid/src/composer` from
`@opencode-ai/session-ui` under MIT: a raw contenteditable over a parts array,
with about 150 lines of cursor math in `editor-dom.ts` and no editor framework
beneath it. Provenance, file by file, is in
`apps/web-solid/src/composer/ATTRIBUTION.md`. Attachments, an `@` mention menu
and drag-drop all ship with it, against the plan's exclusion list
(`docs/plan.md:41-48`).

**Markdown.** `react-markdown` is gone. v1 renders no markdown at all
(`docs/plan.md:42,50`), so pulling in a parser would be shipping a dependency
for a feature the plan excludes.

**Icons.** `lucide-react` → the opencode Icon sprite in `@kiko/ui/v2`.

**Formatter.** `prettier` removed from the app; it was a runtime dependency
where formatters belong to the toolchain.

Kept: `date-fns`, `sugar-high`, `remark-gfm`, `remark-breaks`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `@tailwindcss/vite`.

## Net effect

The React client measured about 445 gzip KiB. Removing tiptap and the effect
runtime lands the Solid client near 160-170 gzip KiB — roughly 60% off, and the
editor stack alone outweighs the entire framework swap.

## Theming

One layer: **`packages/ui/src/styles/kat.css`**. It replaces the old
three-layer `theme/` + `app-theme/` + `kiko.css` stack, all of which is gone.

The palette is split the way kat splits it — lightness and chroma in one
place, hue in one place — so the whole app is recoloured by editing `--hue`:

```css
:root {
  --cm: 1;
  --hue: 340;
  --bg: oklch(0.22 0.05 calc(var(--hue) * 1deg));
  /* …every other role… */
}
```

Roles are registered as Tailwind utilities through an `@theme inline` block,
so a component writes `class="bg-surface-raised text-weak"` and never names a
token in its markup. The same file re-points the vendored `--v2-*` set at the
new roles, which is what keeps the composer's opencode components from
rendering colourless.

```css
@import "tailwindcss";
@import "@kiko/ui/v2/styles/tailwind.css";
@import "@kiko/ui/kat.css";
```

There is no light theme. `--border` is `none` everywhere and hairlines are
painted as `box-shadow: 0 0 0 0.5px …`, so separation comes from shadow or
fill rather than a border.

One trap worth knowing before it bites: `text-*` is one namespace for both
font-size and colour. A colour named `--color-text-muted` silently turns
`text-code` into a background. Ours is `--color-weak`, and a new colour has
to be checked against the size names first.

## The slices

`chat`, `composer`. One git worktree each, one directory each, one
CSS file each. They run side by side against the frozen contract in
`src/lib/types.ts` and share nothing else. `apps/web-solid/OWNERSHIP.md` is the
authority; `src/main.tsx` is the one file nobody edits while they run.

A slice that finds a type wrong changes it on `main` and lets the others pull.
Two divergent contracts is the same dropped-work failure as an unowned file.

## What does not change

The product rules in `AGENTS.md` were written for the React app and they still
hold. A linear transcript, one run per sender. Instant, always. Nothing blocks
anything else. One owner per live value. Tokens over literals.

The one that changes shape is re-rendering. Solid's reactivity is fine-grained
enough that a store write touches only the DOM nodes that read it, which
removes the class of bug the old app was defending against. It does not license
a timer at the top of the tree: a `createSignal` still repaints whatever reads
it, and a ticking clock in a parent is still a screenful a tick.
