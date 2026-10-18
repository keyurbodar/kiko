> Current implementation and verification: [IMPLEMENTATION.md](IMPLEMENTATION.md). The proposals below are historical and do not override it.

# Onboarding: aurora (locked)

> **Update, third round (`aurora.html`):** the owner picked **B4 Aurora**, kept as-is (`A1`). The logo is **R8 Full** (`logo-rich.html`). The sky has no ground and no snow, so Yuki floats above the card's baseline rather than standing on a drift. The aurora family page shows eleven siblings of B4 with the sidebar strip under each; any of them swaps in without touching layout. Where this file disagrees with `aurora.html`, `aurora.html` wins.

The prototype is section 3 of `lock.html`; the sky is `aurora.html` `A1`. Click through both before building.

## Goal

Go from a cold open to typing in three short cards, on one night sky that becomes the sidebar's top band when you finish.

## Today (main)

Four screens: Welcome, Sign in, Provider, Model. The mascot sits in a blueprint orbit. At 1440x900 the provider step runs past the fold, and "Skip for now" sits under it. The welcome screen is a single button with nothing to do.

## Frame

- Full-bleed `AuroraSky` (the same component as the sidebar band, PLAN step 4) at full height. Three blurred ribbons drift on 17s, 21s and 15s `alternate` loops, with a faint curtain-line overlay and sparse static stars. Pure CSS, no canvas, and `prefers-reduced-motion` stops it dead.
- The colour lives in the top 55% of the window and fades to `#0a0a0a` by 70%, so the card and the copy always sit on near-black.
- Yuki at 150px, centred above the card, floating. No ground, no drifts, no snow (the snow variant is `A12` if the owner ever wants it back).
- The card: `width: min(380px, 100vw - 32px)`, top 44px, frosted glass `rgb(10 12 20 / 62%)` with `backdrop-filter: blur(18px)`, radius 20px, a soft shadow, and no border. It has a max height, and lists scroll inside it, so "Skip for now" always shows.
- Progress: three dots on the snow. The current one is an 18px pill.
- No split screen and no access-code field in the hosted flow. Self-hosted builds keep main's access-code step inside the same card.

## Steps (hosted)

`stepsFor(true)` becomes `["sign-in", "cloudflare", "connect"]`. `welcome` and `model` go away (update `progress.test.ts`).

1. **Sign in.** "Welcome to Kiko". Lede: "Text one agent or a team of them. Sign in to find your Kiko from any device." There are two buttons: "Continue with Google" (solid) and "Continue with GitHub" (fill), then "Secured by Clerk". Keep `clerk-step.tsx`'s logic and change only the markup.
2. **Cloudflare.** "Put Kiko on your Cloudflare". Lede: "Kiko runs in your own Cloudflare account. Your chats and keys stay there." Button: "Connect Cloudflare". After that, the card becomes "Installing Kiko" with a thin meter and one status line taken from the real install stages. Keep today's copy, "This takes up to a minute."
3. **Connect a model.** The plan sign-ins (ChatGPT, Claude, GitHub Copilot) as rows, then "Or an API key" with OpenCode Go and OpenRouter, then "More providers" (the existing full list) and "Skip for now". Picking a provider writes "Kiko will think with <model>. Change" under the list. The model is the provider's default from the pi-ai catalog, never hard-coded. "Change" opens the existing model list inline. Then "Start chatting".

## Yuki

Yuki is the bare mark from PLAN step 3, with `data-leaf="front|back"` groups, an eye group for open and one for closed, and a body group. The root gets `data-mood`, and CSS does the rest. Only transform and opacity are animated. The leaves use `transform-box: fill-box; transform-origin: 50% 100%`.

| Mood | When | Motion |
|---|---|---|
| `idle` | default | 4.2s breath (scale 1.025 / .975), leaves sway ±7° on 5.5s, offset 0.2s |
| `curious` | pointer or focus on a button or row | eyes open, a blink every 4s, leans 3° |
| `shy` | the Clerk popup is open | the leaves fold down over the eyes, a tiny shiver, the blush goes to .95 |
| `work` | Cloudflare install | eyes open, pushes a snowball whose `scale` follows the install progress (.25 to 1), leaves flap |
| `perk` | a step completes or a provider is chosen | the leaves spring up once (0.6s overshoot) |
| `pick` | the connect step | eyes open, idle sway |
| `happy` | "Start chatting" or "Skip for now" | three hops with squash and stretch, fast leaf flaps, full blush |

## Finale

After `happy` (about 1.5s), the scene's `clip-path` shrinks from the full window to the sidebar band's rectangle over 900ms. The card, Yuki and the ground fade out, and the shell fades in around it. The band that's left is the sidebar's `NightSky`, so nothing visibly swaps. Then navigate to `/chat/<kiko>` with focus in the composer. Measure the band's rect from the shell skeleton. Don't hard-code 280x96.

## Reduced motion

Yuki holds still in each mood's pose (curious = eyes open, shy = leaves down). The snow and the twinkle stop. The finale cuts with no clip-path animation.

## Delete

- `backdrop.tsx`'s grid, orbits, pulses and satellites (main).
- The PR's mural: `gen-mural.ts`, `mural.gen.ts`, `mural.test.ts` and the "Fig. 1" callouts.
- The snow ground and drift paths from the second round, since the aurora has no ground.

## Acceptance

- Cold open to the sign-in buttons on the first frame after the snapshot.
- At 1440x900 and 390x844, the connect step, including "Skip for now", fits without page scroll.
- Keyboard only: Tab to a button, Enter, choose a provider row, Enter.
- Update the `data-step` and connect hooks in the verify suites in the same PR.
