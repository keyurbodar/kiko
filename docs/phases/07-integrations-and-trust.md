# Phase 7. Integrations and trust

This phase adds the prompt injection defense and connects each user's Executor Cloud account. The trust extension comes first, because Executor tools return outside content and can act in the world.

The Executor Cloud contract is undocumented and its 2.0 release is in beta. Read `docs/research/executor.md` and the result of P0-09 before any task here, and check the facts again against the live service.

## Tasks

### P7-01 Build the trust extension

`deps: P1-12` `difficulty: 4` `area: backend`

**Verify.** `bun yuki verify injection --no-model` passes. Each canned attack runs through fake tools and the suite asserts that no tool with the `external` effect ran without an approval record.

**Goal.** Limit what an injected instruction can do, in code.

**Read first.** Architecture section 16.

**Files.** Create `apps/server/src/agent/extensions/trust.ts`, `apps/server/src/agent/effects.ts`, and `apps/cli/src/verify/suites/injection.ts`. Edit `factory.ts`.

**Build.**

- Make every yuki tool declare one effect: `read`, `write`, `message`, or `external`. A tool with no declared effect fails to register.
- In `afterTool`, wrap results from tools that return outside content in an `<untrusted>` block with a per-run nonce, escape look-alike tags, and mark the run tainted.
- In `beforeTool`, apply the table in section 16.3.
- Wrap agent envelopes in `<agent-message>` and submit them as user-role content. A tainted envelope starts a tainted run.
- Add the three-line rule to the base prompt.
- Assert in the factory test that every agent selects `Trust`.

**Done when.** The attack set has at least ten cases, including a look-alike closing tag, an instruction inside a tool result, and an agent message that claims to be the human.

### P7-02 Build approval cards

`deps: P7-01, P2-08` `difficulty: 3` `area: backend`

**Verify.** `bun yuki verify approvals` passes with a fake `external` tool: a tainted run pauses, the room shows an approval, `approve` with `accept` runs the tool, `decline` returns an error to the model, and a second `approve` for the same id does nothing.

**Goal.** Let the human, and only the human, approve an outside action.

**Read first.** Architecture sections 9.2 and 16.3.

**Files.** Create `apps/server/src/room/approvals.ts` and `apps/web-solid/src/chat/ApprovalCard.tsx`. Edit `agent/extensions/trust.ts`.

**Build.**

- A `ws_approvals(id, run_id, tool, summary, state, expires_at)` table in the room.
- The gate asks the room for an approval and ends the tool call as pending. The decision returns as an `approval_result` envelope.
- Accept the `approve` frame only from a human socket.
- Render the card with the tool name, a plain summary of the arguments, and accept and decline buttons. Show an expired state.

**Done when.** No RPC method that an agent can call changes an approval's state.

### P7-03 Connect an Executor Cloud account

`deps: P4-01, P0-09` `difficulty: 4` `area: backend` `human: yes`

**Verify.** `bun yuki verify executor-connect` passes against a real Executor account: connect, list tools, force a token refresh, disconnect, and see the tokens gone.

**Goal.** Store a per-user Executor credential and keep it fresh.

**Read first.** Architecture sections 12.1 and 12.5. `docs/research/experiment-8-executor-oauth.md`.

**Files.** Create `apps/server/src/integrations/executor/connect.ts` and `executor/token-store.ts`.

**Build.**

- Implement `McpOAuthStateStore` from `pi-mcp` over `UserDO`, with the encryption from P4-01.
- Run the flow that P0-09 proved: OAuth with PKCE and `offline_access`, or the pasted API key.
- Refresh tokens inside `UserDO` only.
- Add `connectExecutor`, `disconnectExecutor`, and `executorStatus` to the user socket.
- A human signs in to the test Executor account once for the suite. Record how in the verification skill.

**Done when.** Disconnect deletes every Executor row for the user in one transaction.

### P7-04 Register Executor tools at run time

`deps: P7-03, P7-01, P4-02` `difficulty: 4` `area: backend`

**Verify.** `bun yuki verify executor-tools` passes against a real account with one integration: the agent's tool list contains every tool that `tools/list` returned, prefixed `executor_`, and one call returns a result wrapped as untrusted.

**Goal.** Expose everything Executor offers, with nothing hardcoded.

**Read first.** Architecture section 12.2.

**Files.** Create `apps/server/src/integrations/executor/tools.ts`. Edit `turn-context.ts` and `factory.ts`.

**Build.**

- At the start of a run, connect to `https://executor.sh/mcp` with the stored options, call `tools/list`, and register each tool from its own name, description, and input schema.
- Store the `mcp-session-id` in `AgentDO` and reuse it.
- Declare the effect of every Executor tool as `external`, except those the server marks read-only.
- If Executor is unreachable, start the run without its tools and tell the model in one line.
- Keep no Executor tool name in the code outside the approval gate of P7-05.

**Done when.** Adding an integration in the Executor console changes the next run's tools with no yuki deploy.

### P7-05 Gate Executor approvals on the human

`deps: P7-04, P7-02` `difficulty: 4` `area: backend`

**Verify.** `bun yuki verify executor-approval` passes against a real account with one tool under a "require approval" policy: the run pauses, a model call to `executor_resume` is rejected, a human accept completes the action, and no answer for 4 minutes expires the card.

**Goal.** Make sure a model can never approve its own paused execution.

**Read first.** Architecture section 12.3.

**Files.** Create `apps/server/src/integrations/executor/approval.ts`.

**Build.**

- Detect a paused result by its `executionId` and create an approval through P7-02.
- Reject every model call to the resume tool in `beforeTool`.
- On a human decision, call `resume` from the host and steer the result into the run.
- Expire the card after 4 minutes and tell the agent to ask again.

**Done when.** The suite's rejection case passes with the model explicitly told to call resume.

### P7-06 Build the integrations settings

`deps: P7-03, P4-05` `difficulty: 2` `area: frontend`

**Verify.** The `verify-yuki` integrations feature against a fake user socket: connect shows the sign-in step, the connected state shows the organization name and the tool count, and disconnect returns to the empty state.

**Goal.** Let a user connect and disconnect Executor.

**Files.** Create `apps/web-solid/src/settings/integrations.tsx`.

**Build.**

- An empty state that explains Executor in two lines and links to it.
- Connect with OAuth, with a paste-key fallback.
- A connected state with the tool list as returned by the server, and the mode option from architecture section 12.2.
- Disconnect, with a confirm.

**Done when.** The screen contains no hardcoded tool or integration name.

### P7-07 Hold URL fetches in tainted runs

`deps: P7-01, P8-02` `difficulty: 2` `area: backend`

**Verify.** `bun yuki verify injection --no-model` passes the new case: a tainted run posts a bubble with a URL that no human message contained, and the room requests no preview for it.

**Goal.** Close the path where an injected instruction sends data out inside a URL.

**Read first.** Architecture section 16.4.

**Files.** Edit `apps/server/src/room/deliver.ts` and the preview trigger in `room/log.ts`.

**Build.**

- Record on each agent message whether its run was tainted.
- Before requesting a preview or an image for a URL in a tainted message, check that the same URL appears in a human message in the room.
- Send the client a flag so the link renders with no automatic preview.

**Done when.** An untainted run's links still get previews.
