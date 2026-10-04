# Issues by wave

Every task in a wave can start once all earlier waves it depends on are merged. Tasks in one wave run at the same time in separate worktrees, except the ones marked "Parallel: no", which run first and alone.

125 tasks in 12 waves. This tree is generated from `docs/phases/` by `bun scripts/plan.ts`.

## Wave 0

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P0-01](wave-00/P0-01-scaffold-the-server-worker-and-the-workspace.md) | Scaffold the server Worker and the workspace | infra | 2 | none | no |
| [P0-02](wave-00/P0-02-clean-the-frontend-baseline.md) | Clean the frontend baseline | frontend | 2 | none | yes |
| [P10-01](wave-00/P10-01-prove-quickjs-runs-in-a-durable-object.md) | Prove QuickJS runs in a Durable Object | backend | 2 | none | no |
| [P11-01](wave-00/P11-01-build-the-log-memory-core.md) | Build the log memory core | backend | 3 | none | no |

## Wave 1

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P0-03](wave-01/P0-03-define-the-wire-protocol-package.md) | Define the wire protocol package | backend | 3 | P0-01 | yes |
| [P0-04](wave-01/P0-04-scaffold-the-kiko-cli.md) | Scaffold the kiko CLI | backend | 2 | P0-01 | yes |
| [P0-05](wave-01/P0-05-prove-pi-durable-in-a-durable-object.md) | Prove pi-durable in a Durable Object | backend | 5 | P0-01 | yes |
| [P0-08](wave-01/P0-08-check-bundle-size-the-model-catalog-and.md) | Check bundle size, the model catalog, and provider imports | backend | 3 | P0-01 | yes |
| [P0-09](wave-01/P0-09-register-kiko-as-an-executor-oauth-client.md) | Register kiko as an Executor OAuth client | backend | 3 | P0-01 | yes |
| [P0-10](wave-01/P0-10-prove-a-solid-binding-for-headless-tree.md) | Prove a Solid binding for headless-tree | frontend | 3 | P0-02 | yes |
| [P0-11](wave-01/P0-11-check-recurrence-across-daylight-saving-changes.md) | Check recurrence across daylight-saving changes | backend | 2 | P0-01 | yes |
| [P0-12](wave-01/P0-12-add-ci-for-typecheck-tests-and-the.md) | Add CI for typecheck, tests, and the plan check | infra | 2 | P0-01 | yes |
| [P0-14](wave-01/P0-14-upgrade-vite-and-compare-the-build.md) | Upgrade Vite and compare the build | frontend | 2 | P0-02 | yes |
| [P1-01](wave-01/P1-01-build-the-alarm-multiplexer.md) | Build the alarm multiplexer | backend | 2 | P0-01 | yes |
| [P1-02](wave-01/P1-02-add-accounts-with-better-auth-and-d1.md) | Add accounts with Better Auth and D1 | backend | 3 | P0-01 | yes |
| [P10-02](wave-01/P10-02-define-the-extension-format.md) | Define the extension format | docs | 2 | P10-01 | yes |
| [P11-02](wave-01/P11-02-read-a-room-as-turns-and-keep.md) | Read a room as turns and keep its tree | backend | 4 | P11-01 | yes |
| [P11-03](wave-01/P11-03-give-each-user-a-life-log.md) | Give each user a life log | backend | 3 | P11-01 | yes |
| [P2-01](wave-01/P2-01-rewrite-the-theme-to-the-kat-values.md) | Rewrite the theme to the kat values | frontend | 3 | P0-02 | yes |
| [P3-02](wave-01/P3-02-reverse-swipe-to-reply.md) | Reverse swipe to reply | frontend | 2 | P0-02 | yes |
| [P8-01](wave-01/P8-01-build-the-safe-fetcher.md) | Build the safe fetcher | backend | 4 | P0-01 | yes |

## Wave 2

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P0-06](wave-02/P0-06-measure-the-cost-of-one-turn.md) | Measure the cost of one turn | backend | 3 | P0-05 | yes |
| [P0-07](wave-02/P0-07-prove-write-coalescing.md) | Prove write coalescing | backend | 4 | P0-05 | yes |
| [P0-13](wave-02/P0-13-create-the-backend-verification-skill.md) | Create the backend verification skill | docs | 3 | P0-04 | yes |
| [P1-03](wave-02/P1-03-route-authenticated-requests-and-sockets-to-durable.md) | Route authenticated requests and sockets to Durable Objects | backend | 3 | P1-02, P0-03 | yes |
| [P1-07](wave-02/P1-07-write-the-bubble-splitter-and-the-reaction.md) | Write the bubble splitter and the reaction tag parser | backend | 3 | P0-03 | yes |
| [P1-08](wave-02/P1-08-parse-agent-markdown-into-the-rich-text.md) | Parse agent markdown into the rich text tree | backend | 3 | P0-03 | yes |
| [P1-09](wave-02/P1-09-add-the-verify-suite-runner-to-the.md) | Add the verify suite runner to the CLI | backend | 3 | P0-04, P1-02, P0-03 | yes |
| [P10-04](wave-02/P10-04-store-extensions-in-userdo.md) | Store extensions in UserDO | backend | 3 | P10-02 | yes |
| [P11-04](wave-02/P11-04-start-every-run-from-memory.md) | Start every run from memory | backend | 4 | P11-02, P11-03 | yes |
| [P11-06](wave-02/P11-06-show-the-life-log.md) | Show the life log | frontend | 3 | P11-03 | yes |
| [P2-02](wave-02/P2-02-build-the-app-shell-and-the-routes.md) | Build the app shell and the routes | frontend | 3 | P0-02, P0-14 | yes |
| [P2-05](wave-02/P2-05-build-the-indexeddb-warm-tier.md) | Build the IndexedDB warm tier | frontend | 4 | P0-02, P0-03 | yes |
| [P3-01](wave-02/P3-01-port-the-typing-indicator.md) | Port the typing indicator | frontend | 3 | P2-01 | yes |
| [P3-04](wave-02/P3-04-collapse-long-messages.md) | Collapse long messages | frontend | 2 | P2-01 | yes |
| [P3-05](wave-02/P3-05-port-system-messages-and-dividers.md) | Port system messages and dividers | frontend | 2 | P2-01 | yes |
| [P3-06](wave-02/P3-06-bring-the-media-viewer-to-telegram-parity.md) | Bring the media viewer to Telegram parity | frontend | 4 | P2-01 | yes |
| [P3-07](wave-02/P3-07-bring-albums-and-multi-file-attachments-to.md) | Bring albums and multi-file attachments to parity | frontend | 3 | P2-01 | yes |
| [P3-08](wave-02/P3-08-build-the-audio-and-video-player.md) | Build the audio and video player | frontend | 3 | P2-01 | yes |
| [P3-09](wave-02/P3-09-port-the-link-preview-card.md) | Port the link preview card | frontend | 3 | P2-01, P0-03 | yes |
| [P3-10](wave-02/P3-10-add-micro-motion.md) | Add micro-motion | frontend | 2 | P2-01 | yes |
| [P4-03](wave-02/P4-03-serve-the-model-catalog-as-a-static.md) | Serve the model catalog as a static asset | infra | 2 | P0-08 | yes |

## Wave 3

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P1-04](wave-03/P1-04-build-the-room-event-log-and-socket.md) | Build the room event log and socket | backend | 4 | P1-03 | yes |
| [P1-05](wave-03/P1-05-build-the-user-object-the-chat-index.md) | Build the user object, the chat index, and the user socket | backend | 3 | P1-03 | yes |
| [P1-06](wave-03/P1-06-build-the-agent-host.md) | Build the agent host | backend | 5 | P0-05, P0-07, P1-01 | yes |
| [P10-07](wave-03/P10-07-build-the-extensions-settings-page.md) | Build the extensions settings page | frontend | 3 | P10-04 | yes |
| [P11-05](wave-03/P11-05-measure-memory-with-an-eval.md) | Measure memory with an eval | backend | 3 | P11-04 | yes |
| [P2-03](wave-03/P2-03-build-the-html-shell-and-split-the.md) | Build the HTML shell and split the bundle by tier | frontend | 4 | P2-02 | yes |
| [P2-04](wave-03/P2-04-build-the-horizontal-tab-strip.md) | Build the horizontal tab strip | frontend | 3 | P2-01, P2-02 | yes |
| [P2-06](wave-03/P2-06-build-the-sync-client-with-optimistic-patches.md) | Build the sync client with optimistic patches | frontend | 5 | P2-05 | yes |
| [P2-12](wave-03/P2-12-mount-toasts-and-i18n-and-lowercase-every.md) | Mount toasts and i18n, and lowercase every string | frontend | 1 | P2-02 | yes |
| [P2-13](wave-03/P2-13-build-sign-in-and-session-bootstrap.md) | Build sign-in and session bootstrap | frontend | 2 | P2-02, P1-02 | yes |
| [P2-15](wave-03/P2-15-give-the-sidebar-its-own-toggle.md) | Give the sidebar its own toggle | frontend | 2 | P2-02 | yes |
| [P3-17](wave-03/P3-17-show-time-dividers-after-a-gap-not.md) | Show time dividers after a gap, not only at a new day | frontend | 2 | P3-05 | yes |
| [P8-02](wave-03/P8-02-build-the-link-preview-route.md) | Build the link preview route | backend | 3 | P8-01, P1-03 | yes |
| [P9-04](wave-03/P9-04-run-the-model-free-suites-in-ci.md) | Run the model-free suites in CI | infra | 3 | P1-09, P0-12 | yes |

## Wave 4

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P1-10](wave-04/P1-10-build-the-agent-factory-and-the-base.md) | Build the agent factory and the base prompt | backend | 3 | P1-06 | yes |
| [P2-07](wave-04/P2-07-replace-the-fixture-store-with-the-sync.md) | Replace the fixture store with the sync client | frontend | 4 | P2-06, P2-02 | yes |
| [P2-11](wave-04/P2-11-throttle-work-in-background-tabs.md) | Throttle work in background tabs | frontend | 2 | P2-06 | yes |
| [P2-16](wave-04/P2-16-add-the-command-registry-and-keyboard-shortcuts.md) | Add the command registry and keyboard shortcuts | frontend | 3 | P2-15 | yes |
| [P3-03](wave-04/P3-03-render-rich-text-and-code-blocks.md) | Render rich text and code blocks | frontend | 3 | P0-03, P2-03 | yes |
| [P3-12](wave-04/P3-12-add-message-search-to-the-room.md) | Add message search to the room | backend | 3 | P1-04 | yes |
| [P4-01](wave-04/P4-01-build-the-encrypted-credential-store.md) | Build the encrypted credential store | backend | 4 | P1-05 | yes |
| [P5-01](wave-04/P5-01-build-the-memory-store.md) | Build the memory store | backend | 3 | P1-05 | yes |
| [P5-05](wave-04/P5-05-build-reminders-with-recurrence.md) | Build reminders with recurrence | backend | 4 | P1-05, P1-04, P1-01, P0-11 | yes |
| [P8-03](wave-04/P8-03-build-file-upload-download-and-the-room.md) | Build file upload, download, and the room file index | backend | 4 | P1-04 | yes |
| [P9-03](wave-04/P9-03-enforce-bundle-budgets-in-ci.md) | Enforce bundle budgets in CI | infra | 2 | P2-03, P0-12 | yes |

## Wave 5

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P1-11](wave-05/P1-11-run-a-full-turn-between-the-room.md) | Run a full turn between the room and the agent | backend | 5 | P1-04, P1-05, P1-07, P1-08, P1-09, P1-10 | yes |
| [P2-09](wave-05/P2-09-build-the-sidebar-chat-list.md) | Build the sidebar chat list | frontend | 3 | P2-07, P2-01 | yes |
| [P2-10](wave-05/P2-10-add-intent-based-preloading.md) | Add intent-based preloading | frontend | 3 | P2-03, P2-07 | yes |
| [P3-14](wave-05/P3-14-build-the-command-palette-and-slash-commands.md) | Build the command palette and slash commands | frontend | 3 | P2-16, P2-07 | yes |
| [P3-16](wave-05/P3-16-persist-drafts-and-scroll-position.md) | Persist drafts and scroll position | frontend | 2 | P2-07 | yes |
| [P4-04](wave-05/P4-04-bridge-provider-sign-in-flows-to-the.md) | Bridge provider sign-in flows to the browser | backend | 4 | P4-01, P0-08 | yes |
| [P4-05](wave-05/P4-05-build-the-provider-and-model-settings.md) | Build the provider and model settings | frontend | 3 | P4-03, P4-01, P2-07 | yes |
| [P5-04](wave-05/P5-04-build-the-memory-screen.md) | Build the memory screen | frontend | 3 | P5-01, P2-07 | yes |
| [P7-03](wave-05/P7-03-connect-an-executor-cloud-account.md) | Connect an Executor Cloud account | backend | 4 | P4-01, P0-09 | yes |
| [P8-04](wave-05/P8-04-process-attachments-in-a-queue.md) | Process attachments in a queue | backend | 3 | P8-03 | yes |
| [P8-07](wave-05/P8-07-build-the-file-tree.md) | Build the file tree | frontend | 4 | P0-10, P8-03, P2-07 | yes |
| [P9-02](wave-05/P9-02-delete-an-account-and-all-its-data.md) | Delete an account and all its data | backend | 3 | P1-05, P8-03 | yes |

## Wave 6

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P1-12](wave-06/P1-12-apply-the-mid-run-rules.md) | Apply the mid-run rules | backend | 4 | P1-11 | yes |
| [P1-13](wave-06/P1-13-harden-wakeups-inboxes-and-socket-setup.md) | Harden wakeups, inboxes, and socket setup | backend | 3 | P1-11 | yes |
| [P2-18](wave-06/P2-18-let-users-theme-everything-with-json.md) | Let users theme everything with JSON | frontend | 4 | P2-01, P4-05, P1-05 | yes |
| [P7-06](wave-06/P7-06-build-the-integrations-settings.md) | Build the integrations settings | frontend | 2 | P7-03, P4-05 | yes |
| [P8-08](wave-06/P8-08-build-the-file-viewer-and-editor.md) | Build the file viewer and editor | frontend | 3 | P8-07 | yes |

## Wave 7

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P2-08](wave-07/P2-08-connect-the-chat-to-the-real-server.md) | Connect the chat to the real server | frontend | 3 | P2-07, P1-12 | yes |
| [P2-19](wave-07/P2-19-build-the-chat-info-panel-and-fold.md) | Build the chat info panel and fold memory into it | frontend | 4 | P1-11, P2-09, P5-04, P8-08, P4-05 | yes |
| [P4-02](wave-07/P4-02-use-each-user-s-credentials-in-a.md) | Use each user's credentials in a run | backend | 3 | P4-01, P1-12 | yes |
| [P5-06](wave-07/P5-06-add-the-reminder-tool-and-agent-wakes.md) | Add the reminder tool and agent wakes | backend | 3 | P5-05, P1-12 | yes |
| [P5-08](wave-07/P5-08-port-skill-loading.md) | Port skill loading | backend | 3 | P1-12 | yes |
| [P6-01](wave-07/P6-01-build-members-recipients-and-the-workspace-brief.md) | Build members, recipients, and the workspace brief | backend | 4 | P1-12 | yes |
| [P6-05](wave-07/P6-05-add-the-subagent-tool.md) | Add the subagent tool | backend | 2 | P1-12 | yes |
| [P6-07](wave-07/P6-07-finish-agent-reactions.md) | Finish agent reactions | backend | 2 | P1-12 | yes |
| [P7-01](wave-07/P7-01-build-the-trust-extension.md) | Build the trust extension | backend | 4 | P1-12 | yes |
| [P8-05](wave-07/P8-05-add-the-file-tools-and-web-fetch.md) | Add the file tools and web fetch | backend | 3 | P8-03, P8-01, P1-12 | yes |

## Wave 8

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P10-03](wave-08/P10-03-build-the-sandbox-and-the-compiler.md) | Build the sandbox and the compiler | backend | 4 | P10-02, P7-01, P1-10 | yes |
| [P2-14](wave-08/P2-14-audit-the-frontend-verification-skill.md) | Audit the frontend verification skill | docs | 3 | P2-08, P2-09, P2-04 | yes |
| [P2-17](wave-08/P2-17-fill-the-sidebar-for-every-section.md) | Fill the sidebar for every section | frontend | 2 | P2-19 | yes |
| [P3-11](wave-08/P3-11-add-stop-edit-regenerate-and-pinned-messages.md) | Add stop, edit, regenerate, and pinned messages | frontend | 3 | P2-08 | yes |
| [P3-13](wave-08/P3-13-build-the-search-screen.md) | Build the search screen | frontend | 3 | P3-12, P2-08 | yes |
| [P3-15](wave-08/P3-15-show-tool-activity-and-agent-status.md) | Show tool activity and agent status | frontend | 3 | P2-08 | yes |
| [P4-06](wave-08/P4-06-prompt-for-a-provider-in-the-chat.md) | Prompt for a provider in the chat | frontend | 2 | P4-02, P2-08 | yes |
| [P4-07](wave-08/P4-07-show-usage-per-chat.md) | Show usage per chat | backend | 2 | P4-02, P2-08 | yes |
| [P5-02](wave-08/P5-02-add-the-memory-tools-and-prompt-sections.md) | Add the memory tools and prompt sections | backend | 3 | P5-01, P4-02 | yes |
| [P5-07](wave-08/P5-07-build-the-schedule-tab-and-the-reminder.md) | Build the schedule tab and the reminder bubble | frontend | 2 | P5-05, P2-08 | yes |
| [P5-09](wave-08/P5-09-build-skill-settings-and-the-skill-command.md) | Build skill settings and the skill command | frontend | 2 | P5-08, P2-08 | yes |
| [P6-02](wave-08/P6-02-build-the-workspace-tables-and-tools.md) | Build the workspace tables and tools | backend | 4 | P6-01 | yes |
| [P6-03](wave-08/P6-03-build-the-messaging-tools-and-loop-protection.md) | Build the messaging tools and loop protection | backend | 4 | P6-01 | yes |
| [P6-08](wave-08/P6-08-build-the-team-chat-interface.md) | Build the team chat interface | frontend | 3 | P6-01, P2-08 | yes |
| [P7-02](wave-08/P7-02-build-approval-cards.md) | Build approval cards | backend | 3 | P7-01, P2-08 | yes |
| [P7-04](wave-08/P7-04-register-executor-tools-at-run-time.md) | Register Executor tools at run time | backend | 4 | P7-03, P7-01, P4-02 | yes |
| [P7-07](wave-08/P7-07-hold-url-fetches-in-tainted-runs.md) | Hold URL fetches in tainted runs | backend | 2 | P7-01, P8-02 | yes |
| [P8-06](wave-08/P8-06-wire-composer-attachments-to-upload.md) | Wire composer attachments to upload | frontend | 3 | P8-03, P2-08 | yes |
| [P8-09](wave-08/P8-09-export-a-chat-as-markdown.md) | Export a chat as markdown | frontend | 1 | P2-08 | yes |

## Wave 9

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P10-05](wave-09/P10-05-sync-extensions-into-each-run.md) | Sync extensions into each run | backend | 3 | P10-03, P10-04 | yes |
| [P5-03](wave-09/P5-03-build-the-daily-tidy-job.md) | Build the daily tidy job | backend | 4 | P5-02 | yes |
| [P6-04](wave-09/P6-04-add-spawn-agent-for-the-lead.md) | Add spawn_agent for the lead | backend | 3 | P6-02, P6-03 | yes |
| [P6-06](wave-09/P6-06-enforce-human-priority-and-stop-across-a.md) | Enforce human priority and stop across a team | backend | 3 | P6-03 | yes |
| [P6-09](wave-09/P6-09-show-a-group-s-tasks-inside-the.md) | Show a group's tasks inside the chat | frontend | 3 | P6-02, P2-08, P2-19 | yes |
| [P7-05](wave-09/P7-05-gate-executor-approvals-on-the-human.md) | Gate Executor approvals on the human | backend | 4 | P7-04, P7-02 | yes |
| [P9-01](wave-09/P9-01-enforce-per-user-limits.md) | Enforce per-user limits | backend | 3 | P4-02, P6-03 | yes |

## Wave 10

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P10-06](wave-10/P10-06-let-agents-write-extensions.md) | Let agents write extensions | backend | 3 | P10-05, P5-08, P8-05 | yes |
| [P9-05](wave-10/P9-05-audit-both-verification-skills.md) | Audit both verification skills | docs | 3 | P6-09, P7-05, P8-08, P5-09 | yes |
| [P9-06](wave-10/P9-06-measure-the-real-cost-and-update-the.md) | Measure the real cost and update the documents | docs | 2 | P6-04, P7-04, P0-06 | yes |
| [P9-07](wave-10/P9-07-prepare-the-production-deploy.md) | Prepare the production deploy | infra | 3 | P9-01, P9-02, P9-04 | yes |

## Wave 11

| Task | Title | Area | Difficulty | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| [P10-08](wave-11/P10-08-seed-the-catalog.md) | Seed the catalog | backend | 2 | P10-06 | yes |
