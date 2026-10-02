# Phase 5. Memory, reminders, and skills

This phase gives agents a memory of the user, a way to schedule, and skills they load on demand. All three live in `UserDO`, except room-level skills.

## Tasks

### P5-01 Build the memory store

`deps: P1-05` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify memory-store` passes: create a record with aliases, find it by an alias, edit it, and read the old version from history.

**Goal.** Store memory records with full-text search and version history.

**Read first.** Architecture sections 13.1 and 13.2.

**Files.** Create `apps/server/src/user/memory.ts`. Edit `apps/server/src/user/schema.ts`.

**Build.**

- Create `memory_records`, `memory_versions`, and the `memory_fts` FTS5 table, kept in step in the same transaction.
- Methods `search(query, limit)`, `view(id)`, `append(id, fact, provenance)`, `replace(id, body, author)`, `pin`, `archive`, and `remove`.
- `view` bumps `uses` and `last_used_at`. `append` adds one dated bullet and never rewrites.
- Seed the `profile`, `now`, and `todo` records on first use.
- Expose the same methods on the user socket for the memory screen.

**Done when.** Every `replace` writes a row to `memory_versions`.

### P5-02 Add the memory tools and prompt sections

`deps: P5-01, P4-02` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify memory-tools` passes with the test model: tell the agent a fact in one chat, ask for it in a second chat, and get it back.

**Goal.** Let agents read memory every turn and write facts when they learn them.

**Read first.** Architecture sections 7.4 and 13.2.

**Files.** Create `apps/server/src/agent/extensions/memory.ts`. Edit `turn-context.ts` and `factory.ts`.

**Build.**

- Add `profile`, `now`, and `todo` to the `turnContext` result.
- A `PromptSection` puts the profile in the system prompt, capped at 1,500 tokens. `now` and `todo` go into the `<context>` block of the input.
- Tools `memory_search`, `memory_view`, and `memory_write`, each a call to `UserDO`. Declare their effects for the trust extension (`read`, `read`, `write`).
- Add one short paragraph to the system prompt on when to write a fact.

**Done when.** A run that calls no memory tool makes exactly one call to `UserDO`.

### P5-03 Build the daily tidy job

`deps: P5-02` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify memory-tidy` passes with the test model: seed two duplicate records and one wrong fact with a correction, run `kiko memory tidy --now`, and see one merged record, a dated correction, and the old bodies in history.

**Goal.** Keep memory small and correct without the main agent doing the work.

**Read first.** Architecture section 13.3.

**Files.** Create `apps/server/src/user/tidy.ts` and `apps/cli/src/commands/memory.ts`.

**Build.**

- Set a daily wakeup in the user's timezone. Skip the run when nothing changed since the last one or when the user has no provider.
- Run the job in a dedicated `AgentDO` named `agent:<userId>:system:tidy`, so `UserDO` holds no harness. Use the user's default model and limit its tools to memory. `system` is a reserved room id that no client can create.
- Merge duplicates, shorten, generalize repeated examples, and replace wrong facts with dated corrections. Update the profile with communication-style traits.
- Archive records that are not pinned and unused for 90 days.
- Never promote a fact whose provenance is tainted into the profile.

**Done when.** The job is idempotent: a second run right after the first changes nothing.

### P5-04 Build the memory screen

`deps: P5-01, P2-07` `difficulty: 3` `area: frontend`

**Verify.** The `verify-kiko` memory feature: open `/memory`, search, open a record, edit it, see the new version in history, pin it, and delete another.

**Goal.** Let a user inspect and correct what kiko remembers.

**Read first.** Product document, "Memory".

**Files.** Create `apps/web-solid/src/memory/`.

**Build.**

- A sidebar list of records grouped by type with a search field, rendered with `content-visibility: auto`.
- A viewer that renders the record with `[[id]]` links as navigation, and an editor on CodeMirror loaded lazily.
- A history panel that shows versions and restores one.
- Pin, archive, and delete, all optimistic.

**Done when.** The route is a tier 4 chunk and preloads on intent.

### P5-05 Build reminders with recurrence

`deps: P1-05, P1-04, P1-01, P0-11` `difficulty: 4` `area: backend`

**Verify.** `bun kiko verify reminders` passes: a reminder due in 3 seconds posts one message to its room, a second alarm for the same time posts nothing, and a daily reminder moves `due_utc` forward by one day in the user's timezone.

**Goal.** Deliver reminders on time, once.

**Read first.** Architecture section 14.

**Files.** Create `apps/server/src/user/reminders.ts`. Edit `apps/server/src/room/deliver.ts` for the dedupe table.

**Build.**

- Create the `reminders` table and methods `create`, `list`, `cancel`, and `snooze`.
- Keep the `reminders` wakeup at the earliest `due_utc` through `alarm.ts`.
- On the alarm, deliver every due row with the id `<reminderId>:<due_utc>`, then compute the next occurrence with `nextOccurrence` or mark the row done.
- In the room, keep a `deliveries(id)` table and ignore an id it has seen.
- A human-target reminder becomes a reminder message in the room.

**Done when.** Killing the server between delivery and the row update still yields one message.

### P5-06 Add the reminder tool and agent wakes

`deps: P5-05, P1-12` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify reminder-tool` passes with the test model: "remind me in 5 seconds to stretch" produces a reminder message, and an agent-target reminder starts a run with a `reminder` envelope.

**Goal.** Let agents create reminders for the human, for themselves, and for other agents.

**Read first.** Architecture sections 7.1 and 14.

**Files.** Create `apps/server/src/agent/extensions/reminders.ts`.

**Build.**

- `create_reminder(text, time_iso, tz, rrule?, target?)`, with the timezone defaulting to the user's.
- Reject a time in the past and an invalid RRULE with an error the model can act on.
- Deliver an agent-target reminder as a `system` envelope with reason `reminder` and hop 0.
- Add `list_reminders` and `cancel_reminder`.

**Done when.** The suite passes and the tool declares the `write` effect.

### P5-07 Build the schedule tab and the reminder bubble

`deps: P5-05, P2-08` `difficulty: 2` `area: frontend`

**Verify.** The `verify-kiko` schedule feature: a reminder appears in the chat info sheet's reminders tab, cancelling it removes it, and a fired reminder renders as a reminder bubble in the chat.

**Goal.** Show what is scheduled and what fired.

**Files.** Create `apps/web-solid/src/chat/team/reminders.tsx` (a tab in the chat info sheet, which every chat has, not only groups) and `apps/web-solid/src/chat/ReminderBubble.tsx`.

**Build.**

- List upcoming reminders with time in the user's timezone, recurrence in words, and target.
- Cancel and snooze, both optimistic.
- Render a reminder message with a clock glyph and a snooze action.

**Done when.** Times render in the user's timezone on a device set to another one.

### P5-08 Port skill loading

`deps: P1-12` `difficulty: 3` `area: backend`

**Verify.** `bun kiko verify skills` passes with the test model: with a built-in skill named `haiku`, a request that matches its description makes the agent call `read_skill("haiku")`, and a room skill with the same name wins over the built-in one.

**Goal.** Give agents skills that load on demand, as pi's coding agent has.

**Read first.** Architecture section 15. `refs/pi/packages/coding-agent/src/core/skills.ts` and `src/utils/frontmatter.ts`.

**Files.** Create `apps/server/src/skills/frontmatter.ts`, `skills/registry.ts`, `apps/server/src/agent/extensions/skills.ts`, and `apps/server/skills/` for built-in skills.

**Build.**

- Parse frontmatter with the same fields and rules as pi: `name`, `description`, `disable-model-invocation`.
- Resolve skills in the order room, user, built-in. The first name wins.
- A `PromptSection` lists name and description in an `<available_skills>` block, with fields escaped.
- `read_skill(name)` returns the body.
- Bundle built-in skills at build time from `apps/server/skills/*/SKILL.md`.

**Done when.** A skill with a missing description is skipped with a warning, as in pi.

### P5-09 Build skill settings and the skill command

`deps: P5-08, P2-08` `difficulty: 2` `area: frontend`

**Verify.** The `verify-kiko` skills feature: add a skill in settings, type `/skill:` in the composer, pick it, and see the agent use it.

**Goal.** Let a user add skills and apply one by hand.

**Files.** Create `apps/web-solid/src/settings/skills.tsx`. Edit `apps/web-solid/src/composer/slash.ts`.

**Build.**

- List built-in, user, and room skills. Create, edit, and delete user and room skills in a CodeMirror editor.
- Validate the name and description in the form with the same rules as the server.
- Expand `/skill:name` into the message that the server turns into a skill block.

**Done when.** An invalid name cannot be saved.
