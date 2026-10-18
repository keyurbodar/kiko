# Onboarding

## Sub-features

Self-hosted: sign-in → connect. Hosted: sign-in → Cloudflare → connect. Provider choice and model choice share one card; old saved `model` resumes `connect`. Bokeh scene and current setup progress remain visible. Skip and finish persist completion to the server.

## How to get to it (user POV)

Use an isolated browser and a fresh dev owner with no providers or onboarding completion. A signed-out local build shows Access code and Continue as dev. Hosted OAuth/install requires a hosted build and real accounts; report that prerequisite instead of simulating success. Visiting `/welcome` as a completed owner redirects to chat and cannot reset setup.

## Driving it with agent-browser

1. Open `/` signed out. Wait for `[data-component=first-run][data-step=sign-in]`. Capture the bokeh `[data-sky=bokeh]` and setup progress. Submit an invalid access code; require a visible alert and retained form. Do not print the code.
2. Sign in as a fresh dev owner through the token recipe. Require `[data-component=first-run][data-step=connect]`, no separate welcome/model card, and `[data-component=first-run-providers]` after catalog load.
3. At both viewport sizes require More providers and Skip for now to be reachable without scrolling the page. Internal card scrolling is allowed. Open `[data-action=view-all-providers]`; require `[data-component=provider-browser]`, search via Search providers and close it. Open an available `[data-action=connect][data-provider][data-via]`; require `[data-component=provider-connect]` and cancel. Provider rows are catalog-driven; never require a fixed count or fixed provider availability.
4. Keyboard: Tab to a provider, Enter opens its dialog; Escape closes and returns focus. Tab to Skip for now, Enter reaches chat. Reload and sign in in a second isolated session for the same owner: setup must stay completed. Capture both transitions, not just the final chat.
5. With a separately authorized connected provider, require the model summary and Change. Open `[data-action=change-model]`; select a `[data-component=first-run-models] [role=radio]`, require one `aria-checked=true`, then Start chatting. Require chat and focus in `.composer-dock .ProseMirror`; reopening the model picker must show the chosen model. Record provider/key prerequisite if unavailable.
6. Hosted: verify the Sign in action opens Clerk with the available sign-in methods, Cloudflare installation progress and failure/retry, then connect. No access-code field in hosted mode. Never perform an install or external OAuth as part of a paint-only audit without authorization.

## Gotchas

`steps.ts`, `progress.ts`, `frame.tsx` and `connect-step.tsx` are authoritative for flow. A previously onboarded owner's token skips setup. Do not force internal signals/localStorage to manufacture a passing setup journey. Skip uses `move("skip")`; composer focus is explicitly requested by Start chatting and must be checked separately for Skip. Do not treat source inspection as live OAuth/install coverage.
