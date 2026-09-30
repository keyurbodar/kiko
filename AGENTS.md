# Kiko

> **NOTE.** Four skills govern how work here is verified. Invoke each as `/skill:<name>` and read it before acting.
>
> - **`/skill:verify-kiko`** is project local, at `.cursor/skills/verify-kiko/`. It drives the real app in a browser, and it is the one that applies to a change under `apps/web-solid` or `packages/ui`.
> - **`/skill:show-me-your-work`**
> - **`/skill:create-verification-skill`**
> - **`/skill:maintain-verification-skill`**
>
> **MUST READ every time: [`ultracite-agents.md`](ultracite-agents.md).** The code standard every change is held to. Read it before writing code, not after a lint failure.

Kiko is an open-source alternative to Grok Bot and Muse Bot. A chat product where the agent is a participant you talk to, not a tool you operate.

This document is about the **frontend**, which is the whole of Kiko today. There is no backend, no server and no database. Every screen reads from local fixtures in `apps/web-solid/src/lib/fixtures.ts`.

**Read these as good defaults, not hard rules.** A rule fighting the task is worth arguing about out loud, to a human, before you break it.

## What makes Kiko special

The things we do not compromise. Each exists because removing it changes what the product is.

### 1. A linear transcript, not bubbles

A conversation reads top to bottom as one column of text. A message is text on a background — no bubble, no box, no per-message fill. Consecutive messages from one sender inside a time window collapse into a **run** that carries the sender's identity once, at its top, rather than on every message.

This is a product decision, not a rendering shortcut. It makes **the agent's words the only channel**: anything the agent did and did not say stays invisible, so it narrates its own work in prose. It makes a message **immutable once it arrives**, which is why nothing here parses a partial document. And it makes the transcript *scannable*, which is the whole reason a person reads a conversation more than once.

Reactions and inline replies are the two affordances that ride on top of it. Both attach to a message already in the column; neither opens a panel or replaces it.

### 2. Instant, always

Every interaction feels immediate. Not just startup. Hover, scroll, send, switch conversation, page back. Something slow enough to notice is a defect, not a trade-off. The failure mode to watch is **animation on things people do dozens of times a minute**, which covers row hover, list highlight and scroll. Anything repeating constantly has no perceptible duration at all.

### 3. Nothing blocks anything else

Work in one part of Kiko must not make another part wait. An agent can be mid-run while the reader types, scrolls, or switches conversations, because **agent busy is not app busy**. The tell is a global loading state, a shared lock, or a state update that re-renders what the reader is not touching.

### 4. One owner per live value

Every value that changes has exactly one thing responsible for it. A fixture module owns the initial data, `src/lib/store.ts` owns the values that move, and a component owns its own local state. Two owners is where the bugs that take days to find come from, so a second cache, a second dark-mode mechanism or a second source of truth is the signal to stop and delete one.

### 5. The design system is enforced

Kiko owns its visual language. Colour, spacing, radius, border and type are tokens, and a raw value where a token exists is a defect. The role names resolve through `packages/ui/src/styles/kat.css`, so a slice writes `bg-surface-raised` and never names a token in its class attribute. Tokens over literals is the difference between a theme we can change and one we cannot.

## A note from Keyur

I care about how the product feels more than how the code reads. Performance is a feature I will not trade away, and I will not trade features away for it either. Both.

Prefer the smallest change that solves the real problem. Refuse machinery that looks impressive. Fight scope creep, including your own. Fast, but never a shortcut.

## A small glossary

- **you** means the agent reading this and changing Kiko.
- **we, us, maintainers** means Keyur and the people building Kiko.
- **reader** means the person using Kiko to talk to agents.
- **agent** means the bot in a conversation. It may also mean you.
- **message** means one rendered message. A message is text on a background, never a bubble.
- **run** means the maximal sequence of consecutive messages from one sender inside a time window.
- **position** means where a message sits in its run: `only`, `first`, `middle`, `last`.
- **resident window** means the pages held in memory around the viewport.
- **evict** means drop a page that drifted too far. **dispose** means release what it owned. Eviction without disposal is a leak.
- **token** means a design token, a CSS custom property.
- **worktree** means one git worktree, a sibling checkout at `../kiko-<slice>/`, owned by one agent.
- **wave** means a group of worktrees that can run at once without touching one file.

## The ways to hurt yourself

1. **Re-rendering the list.** A timer, cursor blink or elapsed counter whose state reaches the parent repaints a screenful every tick. Update the text node directly, or scope the signal to the row. A ticking clock is not a reason to repaint a conversation. Solid's fine-grained updates shrink the blast radius of a signal, but a `createSignal` still updates every node that reads it, and one at the top of the tree is still a screenful a tick.
2. **Unbounded growth.** Anything long-lived in memory is a leak with a delay on it. Message arrays, caches, parsed output, Maps, blob URLs, decoded images. Each needs a boundary, and the boundary is a number you can read rather than a hope.
3. **Eviction that only splices an array.** Dropping a page releases nothing. Blob URLs, highlight entries, timers, observers and media survive unless something releases them, and the release must come off the scroll handler or it drops a frame.
4. **Installing a dependency.** One installer per worktree, never two at once. `package.json` and the lockfile cannot be touched by two worktrees together, so a slice that needs a new package raises it rather than installing it.

## Parallelism

- **Spawn as many subagents as the work needs.** No limit. If background agents are available, use them.
- **Always work in parallel**, and more of it when the user sends more requests.
- **Assigning work never stops you.** After dispatching, take one of the tasks yourself and keep going.
- **One file, one agent.** Two changes landing in one file go to the same agent, never two agents serialised onto it.
- **One edit, two changes.** Two tasks in one file get planned together and implemented in a single edit. Never plan-implement-plan-implement.
- **No compromise.** Not on parallelism, and not on the result.

## Hit every surface

The commonest defect here is a change that works on the path you tested and is wrong everywhere else. Before calling frontend work done, walk this list and say which entries applied.

- **Conversation modes.** A one-to-one does render an avatar. The avatar appears once per run, at the **first** message of the run, top-aligned with the sender's name. Every later message in the run indents under it with no avatar and no repeated name.
- **Input kind.** Desktop reveals metadata on hover. Touch has no hover, so it stays visible.
- **Viewport.** Wide keeps the 768px column. Narrow collapses the sidebar.
- **States.** Empty, loading, error, and the waiting state while an agent works. Loading and error have no async behind them in v1 and are not mounted; empty and waiting are.
- **Motion preference.** Reduced motion is honoured. Nothing loops except a genuine wait.
- **Scale.** A conversation with three messages, and one with twenty thousand.

## Frontend engineering goals

What we optimise for, in priority order.

1. **Memory proportional to attention.** RAM tracks what the reader is looking at, not how long the conversation is.
2. **No unnecessary work.** No subscription nobody reads, no render nobody sees, no timer ticking for a closed panel.
3. **A tiny hot working set.** A little in memory, and nothing held past the moment it is needed.
4. **Simple enough to keep.** Fewer moving parts beats clever architecture.

## Where code lives

Kiko is a **bun workspace**. Two members, and that is the whole repo.

```
apps/web-solid/            the app, and the only one we build in
  src/lib/                 types, fixtures, store — the frozen contract
  src/<slice>/             one directory per slice, one owner each
  OWNERSHIP.md             who writes what
packages/ui/               @kiko/ui, the design system
  src/v2/                  the opencode v2 components
  src/styles/kat.css       the kat token layer — the only theme
docs/                      the plan, the port, the decisions behind them
refs/                      gitignored reference repos
```

`apps/web` is the old React app. It is frozen and kept as reference: its source
still imports packages the port removed, because the removal was a manifest
change and nothing else. Do not write new code there.

There is no `worker/`, no `confect/` and no `convex/`. Those described a backend
that does not exist.

Styling enters through `apps/web-solid/src/styles/app.css`, one `@import` per
layer, Kiko's last. Tailwind v4 comes in through `@tailwindcss/vite`, so there
is no `tailwind.config.js` and no PostCSS chain.

## Components

**Never build a UI component from scratch, and never vendor one by hand.** A component comes from one of three doors: the opencode v2 set already in `packages/ui/src/v2`, an **npm package**, or the **shadcn registry through the CLI** where a React component is genuinely the only thing that exists. Nothing is copied in, hand-edited or hand-written.

```bash
bunx --bun shadcn@latest add <name>
```


**The order we look in for anything** is **pi-do/web-legacy first, then akeru-bot, then t3code.** For UI that order runs through the sources above, which is where a component is actually taken from.

**The order is where we look, not what we settle for.** It decides which source opens first, and which one wins a filename collision when two supply the same name. It never justifies a worse component. When a later source fits the need better, take it, and say why in the PR.

**Pure logic is not a component.** A rules module such as `roster.logic.ts` or `grouping.ts` is ours to write, and so is glue. A button, a row, a divider or a dialog is not. Layout a component does not ship is ours to style, in the slice's own stylesheet, against our own `data-*` attributes.

## References

Start here. Do not go looking for a fifth opinion when a decision is already recorded.


- **Port.** [`docs/solid-port.md`](docs/solid-port.md) is why the frontend is Solid, what the dependency changes were, and how the three theming layers stack. Read it before touching `apps/web-solid` or `packages/ui`.
- **Stack.** [`docs/tech-stack.md`](docs/tech-stack.md) holds every dependency and why alternatives were rejected.
- **Plan.** [`docs/plan.md`](docs/plan.md) is what v1 contains and what it excludes, and [`apps/web-solid/OWNERSHIP.md`](apps/web-solid/OWNERSHIP.md) is directory ownership per worktree.
- **Read-only.** `refs/t3code/`, `refs/confect/`. Never import from or edit `refs/`.

## Verifying

- **Fast, parallel, non-blocking.** Every check finishes in under two minutes and runs beside others rather than gating them. A check that cannot is scoped wrong, so split it instead of waiting on it.
- **Runtime proof for anything you can see.** Typecheck is the floor, not the verdict. A component that compiles and renders wrong has failed.
- **Measure, do not eyeball.** The transcript column, the top bar height, the avatar gutter — these are numbers, read rather than estimated.
- **Script the check.** A deterministic script a reviewer re-runs beats an eyeball, and it survives into the next ship.
- **No test pile.** No duplicated tests, no test that restates the implementation, no test written so a change has tests.
- **Scope it, then rebase.** Run what covers the change, and never verify against a stale base.

## Worktrees and pull requests

- One worktree owns one directory subtree. Take the paths your slice names and no others — `apps/web-solid/OWNERSHIP.md` is the authority. Take a file you do not own and you have created a conflict somebody else resolves badly.
- One worktree, one branch, one PR. Dependencies are blocked-by relations, never two agents on a branch.
- One concern per PR. If the description says "also", split it.

## Taste

- **No comments, ever.** Not one line. Not a why note, not a section header, not a JSDoc block, not a lint or TypeScript suppression. If a fact matters, encode it in a type, a test, a lint, or the code's own shape so it holds without prose.
- Existing patterns over new abstractions. Delete weightless code.
- The reader notices a dropped frame, a spinner that lies, a stale label. They drive agents all day and they are watching.
- Inferred types over annotations. `any` is the enemy.
