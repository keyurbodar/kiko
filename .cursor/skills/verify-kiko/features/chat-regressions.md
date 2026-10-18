# Chat regressions

## Sub-features

Main message bubbles, composer/model picker, optimistic sending, agent replies, run details, persisted snapshot and reduced motion.

## How to get to it (user POV)

Open a chat after setup. For sending/reply proof use the model setup recipe and an authorized provider. For model-free proof use a room with existing messages and finished run details. A blank chat cannot prove preserved bubbles or run-panel behavior.

## Driving it with agent-browser

1. Capture `[data-component=chat-transcript]` containing human and agent messages. Compare shape, grouping, text wrapping and spacing to main's bubble baseline in dark/light at desktop/mobile. Check Figtree/Bricolage, Remix icons and approved L1 mark visually plus computed font-family; a font-family string alone does not prove a font loaded.
2. Use textbox Message inside `[data-component=prompt-input]`. Type a draft, navigate away/back and reload; require draft retention. Empty Send is disabled. Open `[data-component=model-picker-button]`; require `[data-component=model-picker]`. Search/select through the UI, close and verify selected composer model. With no provider, require the connect-provider affordance instead of a usable model list.
3. Send a unique short prompt. Capture the optimistic human bubble before the response, then an actual agent reply and completed run. Require the sent draft clears, no duplicate human bubble appears after reload, and typing/sending does not move the composer controls. Sending spends a model key; record BLOCKED if unauthorized or unavailable.
4. Open finished run details from its visible opener. Close with Escape; require focus returns to that opener. Existing completed/live runs need fixtures: record missing fixtures rather than manufacturing a success. Tool panel has no motion.
5. Warm-load a chat, then reload offline. Require the saved transcript/sidebar snapshot renders before reconnecting. Restore network immediately after capture. Use a separate browser context for JavaScript-disabled persisted snapshot proof; do not disable scripts globally or alter another session.
6. Repeat overlays and navigation with reduced motion. Inspect running animations as well as screenshots. Buttons, tabs and composer stay still; message motion must not delay optimistic paint.

## Gotchas

The sidebar/settings gates can pass while send/run behavior is broken. No reply means sending is unverified even when the optimistic bubble is visible. Offline snapshot tests require a previously loaded chat; cold signed-out boot is a different case. Keep screenshots/transcripts free of secrets. Backend message semantics remain covered by CLI suites, not visual comparison.
