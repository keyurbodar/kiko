# Tech stack

Every dependency Kiko uses, grouped by what it is for. Decisions trace back to `kiko-frontend-plan.html`; the numbers quoted here were measured, not estimated.

**Two rules govern additions:** check the platform first (Convex, Cloudflare Workers / Durable Objects) before adding anything, and prefer the boring option. A package earns its place only when it does something the platform or an already-chosen package does not.

---

## 1. Core platform — data and runtime

The whole backend. No hand-rolled transport, no state runtime, no server.

| Package | Version | Role | Notes |
| --- | --- | --- | --- |
| `confect` packages | 9.4.4 | The data layer, written as Effect over Convex | See the section below. All packages release together |
| `effect` | ^3.21.2 | Peer of every confect package | **Server and codegen only.** Kept out of the browser on purpose |
| `@confect/core` | 9.4.4 | Shared specs, schemas and types | Peers `convex ^1.32.0` |
| `@confect/server` | 9.4.4 | Table and function bindings to Convex | Peers `@effect/platform` |
| `@confect/cli` | 9.4.4 | Codegen and dev-mode watching. Ships the `confect` binary | Generates into `confect/` and into `convex/` |
| `@confect/test` | 9.4.4 | Testing via `convex-test` | Peers `convex-test >=0.0.50 <0.1.0` |
| `convex` | ^1.36.0 | The platform underneath | Reactive queries, transactions, scheduler, file storage, search |
| `@convex-dev/agent` | latest | Thread and message storage, tool calling, RAG, the agent loop | **Server half only.** Its browser helpers exist to smooth a streamed response, and there is no visible stream |
| `wrangler` | latest | Deploy and configure the Worker, static assets, Durable Objects | Replaces the reference's hosted deploy config |
| `@cloudflare/vite-plugin` | latest | Runs the Worker and Durable Objects inside the dev server | One dev loop, not two |
| `@cloudflare/vitest-pool-workers` | latest | Tests Worker and DO code in the real runtime | Real workerd, not a mock |

### Why confect rather than plain Convex functions

Confect integrates Effect with Convex and changes three things worth the dependency.

**Tables are Effect schemas, one file each.** A table declares its fields, indexes, search index and vector index in one chain. Because each table is its own file, tables parallelise. Plain Convex would have made the schema a single-writer bottleneck.

**Functions split into a spec and an implementation.** The spec declares args, return type and error type. The impl holds the behaviour. The client's types come from the spec, so the contract is generated rather than hand-maintained.

**Errors are typed end to end.** A `Schema.TaggedError` in a spec becomes part of the function's signature. A failure mode is a type, not an exception.

It also supplies `publicPaginatedQuery` natively, which is what the resident window pages through.

### The client deliberately does not use `@confect/react`

`@confect/react` imports Effect at runtime. Measured after bundling and tree-shaking, the modules it pulls cost **208.5 KiB raw and 69.0 KiB gzip**, or **70.9 KiB at Zstandard's default level**, which is what a Free-plan deployment actually serves. That would be the largest single client cost in the stack. Astryx was rejected for 27.4 KiB gzip of CSS.

**It is avoidable because the data does not need Effect.** `QueryResult` is a plain tagged union of `Loading`, `Success` and `Failure`. Effect is in that package for the `match` and `dual` helpers, not for the data shape.

The client uses plain `convex/react` and branches on `_tag`. It keeps the end-to-end types and the typed errors, and keeps roughly 105 KiB gzip out of the browser. Optimistic updates use Convex's own `withOptimisticUpdate`. Revisit only against a measured bundle, since tree-shaking does recover some of that figure.

**What this replaces:** the reference builds reactive state, connection supervision, RPC sessions, retry ladders and an event-sourced read model by hand. All of it goes.

### Compression is the edge's job

Nothing on the client, nothing in the build. Cloudflare compresses responses automatically and caches the compressed variant.

**The algorithm depends on the plan, and Brotli is not the Free default.**

| Plan          | Default between visitors and Cloudflare |
| ------------- | --------------------------------------- |
| Free          | **Zstandard**                           |
| Pro, Business | **Brotli**                              |
| Enterprise    | Gzip                                    |

The client's `accept-encoding` header also influences the choice. So we do not pick the algorithm. We just make sure nothing disables it.

Measured on our real artifacts, at levels comparable to on-the-fly compression:

| Artifact | Raw | Brotli q5 | Zstandard default | Gzip 9 |
| --- | --: | --: | --: | --: |
| Effect, tree-shaken | 208.5 KiB | 65.3 KiB | 70.9 KiB | 69.0 KiB |
| sugar-high, all 27 languages | 32.5 KiB | 8.2 KiB | 9.4 KiB | 8.5 KiB |
| Shiki's Oniguruma WASM engine | 607.9 KiB | — | — | 225.1 KiB |

The realistic spread between Brotli and Zstandard is around 8%, and both beat Gzip. It is not worth optimising for a specific one.

**Three rules worth knowing.**

Responses under **50 bytes** are not compressed by Brotli or Zstandard, and under 48 bytes by Gzip. Only status **200** is compressed, plus 403 and 404. And Cloudflare **may drop `Content-Length`** when it compresses, which is normal.

The content types Cloudflare compresses include everything we ship: `text/html`, `text/css`, `application/javascript`, `application/json`, `image/svg+xml`, web fonts and `application/wasm`.

**Two things not to do.**

**Do not pre-compress.** Cloudflare compresses on the fly and caches the result, so emitting `.br` and `.gz` pairs at build time adds build complexity for no gain. This is the same reasoning that removed the reference's compression middleware.

**Do not set `cache-control: no-transform`.** That header disables Cloudflare's compression entirely and preserves `Content-Length`. It is the opposite of what we want.

---

## 2. Build and bundler — frontend engineering

**Rolldown, the way the reference does it.** `vite` is an alias to the rolldown-backed core, and the React Compiler runs through a Babel pass inside that pipeline.

| Package | Version | Role |
| --- | --- | --- |
| `vite-plus` | 0.3.3 | Task runner and config surface (`vp dev / build / test`) |
| `vite` | `npm:@voidzero-dev/vite-plus-core@0.3.3` | The bundler behind it. **Not upstream Vite** — do not swap it |
| `@vitejs/plugin-react` | ^6.0.0 | Fast refresh, and it **exports `reactCompilerPreset`** |
| `@rolldown/plugin-babel` | ^0.2.0 | The channel the React Compiler runs through. Not a workaround |
| `babel-plugin-react-compiler` | 1.0.0 | The compiler itself |
| `@types/babel__core` | ^7.20.5 | Types for the inline Babel options |
| `rolldown` | 1.2.5 | Transitive, via `vite-plus` |

> The three Babel rows move together. They are needed because the compiler is applied through the Babel pass on a rolldown pipeline — a bundler with native compiler support would not need them.

---

## 3. Routing — frontend engineering

| Package | Version | Role |
| --- | --- | --- |
| `@tanstack/react-router` | ^1.160.2 | Type-safe routing |
| `@tanstack/router-plugin` | ^1.161.0 | Route-tree codegen and automatic code splitting |

**No server rendering.** The reference does not use `@tanstack/react-start`, and neither do we.

---

## 4. Styling and tokens — UI

| Package | Version | Role | Notes |
| --- | --- | --- | --- |
| `tailwindcss` | 4.3.3 | Utility CSS | **Build-time only** — zero imports in application code |
| `@tailwindcss/vite` | 4.3.3 | Its Vite integration | Resolves against the rolldown core |
| `class-variance-authority` | ^0.7.1 | Component variant API | For our own components only — library components ship their own variants |
| `tailwind-merge` | ^3.4.0 | Conditional class merging | One `cn()` helper |

Tokens are **CSS custom properties**, exposed to Tailwind v4 through `@theme inline`. Colour mode is owned by exactly one mechanism — `data-theme` on `<html>`. Never a second provider.

v1 ships the preset's own token values unchanged.

---

## 5. UI components — UI

Sourced in a fixed priority order. **pi-do/web-legacy → akeru-bot → t3code.**

It is a fast shipping order, not a ranking. It decides which source opens first and which one wins a name collision when two supply the same name. It never justifies a worse component. When a later source fits the need better, take it and say why. `AGENTS.md` holds the rule.

**Components arrive two ways, and only two.** Through the **shadcn registry CLI**, `bunx --bun shadcn@latest add <name>`, and as **npm packages**.

**Nothing is vendored by hand. Nothing is hand-built. There is no custom CSS.** A component that is missing is not a reason to write one. Find it in a source, or install it as a package.

**t3code is the one exception.** Its logic modules are small and self-contained, so copying the logic rather than importing a package is acceptable there. That covers logic modules only, never a component file.

| Source | What we take | Licence | Notes |
| --- | --- | --- | --- |
| **pi-do/web-legacy** `web-legacy/src/components` | The first source we open, and the closest match to our chat surface. `chat/` holds `ThreadPane`, `MessageBubble`, `ActivityRow`, `GroupPane`, `ChoiceWidget`, `FileCard` and `MessageControls`. Also `prompt-input/`, `roster/`, `thread/` with its reducer and `useThread`, and `ui/` | MIT | The chat surface is defined here first. Delivery is still the registry CLI or a package, never a copied file. Already on `@base-ui/react ^1.8.0`, the version we pin |
| **akeru-bot** `apps/web/src/components` | The shadcn-configured web app. Chat and workspace surfaces the first source does not cover, plus `ui/`, `settings/`, `sidebar/` and `search/` | MIT | Installed through the registry CLI or as a package. On `@base-ui/react ^1.4.1`, below the version we pin |
| **t3code** `components/ui` | The 53-file primitive layer, and the chat row's rendering details | Inherited from the fork | The one place copying logic beats importing a package. Copying covers its small self-contained logic modules, not component files. No upstream merges |
| **shadcn/ui** (`base` variant) | **`Message`, `MessageGroup`, `MessageAvatar`, `MessageContent`, `MessageHeader`, `MessageFooter`** — the chat anatomy. **`Bubble`, `BubbleContent`, `BubbleGroup`, `BubbleReactions`** — the bubble. **`Marker`** — the typing/liveness row. **`MessageScroller`** — the scroll container. **`Attachment`** + 6 parts — image and file attachments | MIT | Take the **`base`** flavour, not `radix` — it matches our primitive choice |
| **coss.com/ui** | Shell pieces the above do not cover: sidebar kit, scroll area with scroll-fade, command palette, toast, empty states, kbd, input groups | **AGPL-3.0-or-later** — accepted | Installed via the shadcn registry CLI, not npm. **Strip its `shiki`, `rehype-pretty-code`, `lucide-react` and `next-themes`** — they collide with choices below |
| **interior** | **Last resort only.** Look here when a long-running state genuinely needs a piece the registry and the packages do not supply | MIT | Reaches us through the registry CLI or as a package, never as a copied file. Any adoption adds `motion`, see §8. Expected to be skipped almost always |

| Package | Version | Role | Licence |
| --- | --- | --- | --- |
| `@base-ui/react` | **1.8.0** | Headless primitives — behaviour and accessibility, zero CSS | MIT |
| `@legendapp/list` | 3.3.5 | The virtualizer | MIT |
| `@mingcute/react` | 3.0.2 | Icons — 24×24 SVG components, imported individually | Apache-2.0 |

`@base-ui/react` is bumped from the reference's `^1.4.1` to **1.8.0**, which is what coss pins.

---

## 6. Content rendering

| Package              | Version | Role                                        |
| -------------------- | ------- | ------------------------------------------- |
| `react-markdown`     | ^10.1.0 | Markdown renderer with component overrides  |
| `remark-gfm`         | ^4.0.1  | Tables, strikethrough, task lists           |
| `remark-breaks`      | ^4.0.0  | A single newline is a hard break            |
| `sugar-high`         | 2.x     | Code-block highlighting                     |
| `@sugar-high/remark` | 1.0.2   | Remark plugin that highlights fenced blocks |

**Why sugar-high over Shiki.** Synchronous lexer — no WASM, no worker, no async, **zero runtime dependencies**. Measured: the whole library including **all 27 languages** is **32.5 KiB raw / 8.5 KiB gzip**, against a Shiki WASM engine of **607.8 KiB raw / 225.1 KiB gzip on its own** — 18.7× and 26.6×, before a grammar or theme. Shiki's WASM-free engine is no escape either: ~524 KiB of raw JS across four packages, and the reference rejected it because the JS regex engine can backtrack catastrophically.

The trade, stated plainly: sugar-high is a **lexer, not a grammar engine**, so highlighting is approximate. In a chat bubble showing an agent's snippet, that is the right side of the trade.

Its remark plugin emits **element trees with text children, not an HTML string** — so React escapes the code and nothing writes `innerHTML`. That is what lets `rehype-raw` and `rehype-sanitize` stay out.

---

## 7. Client persistence

| Package | Version | Role                                              |
| ------- | ------- | ------------------------------------------------- |
| `idb`   | latest  | Promise wrapper for the conversation window cache |

The cache holds **a window, not the history**. Convex stays the source of truth. See §5 of the plan for the resident-window design.

---

## 8. Motion — conditional

| Package | Version | Role |
| --- | --- | --- |
| `motion` | ^12 | Animation runtime, **only if** an interior component is adopted |

**Expected to be omitted.** The requirement is fast, minimal motion: no perceptible duration on anything done repeatedly, and looping animation only in genuinely-waiting states. There is no CSS-only subset of interior — one file pulls the runtime in. If nothing genuinely needs it, it never enters the tree.

---

## 9. Testing

| Package | Version | Role |
| --- | --- | --- |
| `@confect/test` | 9.4.4 | Confect function tests via `convex-test`. Has a mock-backend and a local-backend mode |
| `convex-test` | `>=0.0.50 <0.1.0` | The Convex test harness underneath |
| `vitest` | latest | The runner |
| `react-test-renderer` | 19.2.6 | Component tests **without a DOM**. The reference uses it in 31 files |
| `@types/react-test-renderer` | 19.1.0 | Types for it |

The mock backend is the fast path for the suite. The local backend is for integration tests that need real Convex behaviour.

---

## 10. Runtime and toolchain

|  | Choice | Notes |
| --- | --- | --- |
| Package manager | **bun** | `bun.lock` is text, so it merges better than a pnpm lockfile |
| Script runner | **bun** | `bun run` and `bun run --cwd <pkg> <script>`, matching `pi-do` |
| Runtime for CLIs | **bun wherever it works** | Verified for confect's CLI. Convex's CLI is already driven this way in `pi-do` |
| Workspace | **bun workspace** | Flat members, matching `pi-do`'s shape rather than `apps/` plus `packages/` |
| Lint | **oxlint** | Matching `pi-do`. Not eslint |
| Format | **oxfmt** | Matching `pi-do`. Not prettier |
| Tests | **vitest**, run through bun | `@confect/test` and `convex-test` are built for vitest |

| Package     | Version |
| ----------- | ------- |
| `react`     | 19.2.6  |
| `react-dom` | 19.2.6  |

**Node 22 or newer is still a real requirement underneath.** Confect declares it, rolldown's native bindings target it, and wrangler expects it. Bun satisfies it in practice, and the requirement is worth knowing before a tool misbehaves rather than after.

---

## Appendix — dropped, and why

Kept for traceability. Nothing here should reappear without a reason.

| Dropped | Replaced by |
| --- | --- |
| `effect`, `@effect/atom-react` | Convex owns reactivity, transport and scheduling. **`effect` returns as a server-side peer of confect** in §1. `@effect/atom-react` stays out |
| `@t3tools/client-runtime`, `@t3tools/contracts`, `@t3tools/shared` | Convex client + `convex/schema.ts` |
| `@vercel/config` | Wrangler |
| `shiki` | `sugar-high` — 27× lighter, no WASM |
| `rehype-raw`, `rehype-sanitize`, `unified`, `@types/mdast`, `hast-util-to-html`, `hast-util-to-jsx-runtime` | No raw HTML, no custom AST plugin, no incremental parser |
| `@tiptap/*` (7 packages) | A controlled textarea |
| `lucide-react` | MingCute |
| `@dnd-kit/*` (4) + `@formkit/auto-animate` | Not needed — no drag-to-reorder |
| `@pierre/diffs`, `@pierre/trees` | No diff or filesystem surface |
| `@tanstack/react-start` | No server rendering |
| `@convex-dev/react-query` | No SSR means no loaders to integrate with; Convex hooks own cache lifetime |
| **Astryx** (`@astryxdesign/*`, `@stylexjs/stylex`) | Its components own layout and spacing on a fixed 4px rhythm, which fights our spacing scale. Not a licence or quality problem — a shape problem |
| Terminal, diffs, PRs, desktop, mobile, provider management | Out of scope entirely |

---

## Open

**Where the app lives** is not yet decided, so nothing has been installed. The proposed shape is a flat root — `src/`, `convex/`, `worker/`, and a gitignored `refs/` — matching the existing convention in `pi-do`.
