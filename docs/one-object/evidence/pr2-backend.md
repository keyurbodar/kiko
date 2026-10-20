# PR2 backend checkpoint

Implementation in progress. No gate result is claimed here.

OwnerDO is the only bound Durable Object. Plain User, Room and Agent services receive one owner service directory and contexts over the same physical SQLite database. Existing append-only schema steps remain intact. Scoped table names and KV keys preserve per-room and per-agent ownership until PR4 consolidates the schema; no additional database is created. Internal services call each other directly. Only the Worker uses ownerStub.

OwnerServices provides user(), room(roomId), agent(roomId, slug), files(), and egress(). OwnerDO owns socket upgrade, user frames and room subscriptions. Room socket views wrap outgoing frames as {t:'room',roomId,frame}; subscriptions replay through the existing room hello handler. User frames retain their existing shape.

Agent Harnesses open lazily. The owner evicts idle least-recently-used Harnesses above eight and retains each agent's next deadline. Admission uses pi conversation.submit with the burst's stable request id. Human input steers; other input follows up. PR1 journal replay, recovery and idle cleanup remain.

The storage context projects service deadlines onto OwnerDO's alarm while retaining existing scoped scheduling semantics. Replacing application scheduling with the PR3 clock is outside this change. PR5 invocation changes and PR4 schema consolidation remain separate.

The worker decision must evaluate pi 1.3's real background anchor-task and durable reporter API, including README lines 538-580 and example23-subagent-background.ts. A foreground ownership comparison alone is insufficient.

The orchestrator owns gates and the baseline. Supplied baseline warm whole-prompt samples are 79, 81, 79, 79, 79 rows. Backend validation here is limited to targeted server/core checks. Dependencies are installed. Runtime and temporary state use /home/keyur/.cache because /tmp is full.

## First buildable checkpoint

Server and core/agent typechecks passed after the initial OwnerDO integration. This is a compile checkpoint, not a passing PR gate. A real Miniflare SQLite test passes with an `agents` table and an `agents` column in `chats`, qualified reads, aliases, external-content FTS5 triggers, bound sqlite_master predicates, PRAGMA table_info, and isolated erase. The earlier broad identifier substitution was replaced with contextual table-position substitution. Further schema migration and real service integration tests remain necessary.

ServiceOptions explicitly carries ctx, sql, broadcast, env and services. factory.ts exports openAgentHarness and AgentHost receives that opener. OwnerDO.dispatchRun(roomId, slug) is the PR5 scheduling seam; its PR2 fallback calls Agent.alarm. OwnerServices carries dispatchRun and afterRun. Scoped alarm changes and OwnerDO.alarm call refreshClock, whose current implementation projects owner_deadlines. The single initializeSchema(storage) call receives the actual owner storage; PR4 replaces its current inline owner_deadlines DDL and migrates all raw scoped queries. The inline afterRun and archive hooks are placeholders for PR3/PR6 and run from the Agent idle callback once wired. Later PR files were not created.

Current implementation still requires lifecycle, worker reporter, full service schema, invalidation and gate validation. Root owns the commit and gate measurements; this task makes no commits.

The scope adapter now restricts table-position substitutions to schema-declared or discovered table/index/trigger names, preserving table-valued functions such as json_each and CTE names. File integration exposed the function-name case after the initial context fixture passed; this was fixed before claiming file integration success.

## Runtime checkpoint after skeleton d88bb3a4

The orchestrator committed the skeleton; this backend task did not commit. Subsequent targeted server and core/agent typechecks also completed successfully. The real Agent.beginRun model test passes, proving a retained Harness configures the changed model on the next run. The initial focused native-background-worker test passes, proving a human reply can finish while a worker tool remains pending; stop/crash checks remain in progress.

A live smoke against the orchestrator's existing localhost:8894 server passed health, POST dev session and authenticated /api/me. One websocket received the unchanged user snapshot, subscribed to its home room, received wrapped room replay, unsubscribed, and received bare pong from the runtime ping auto-response. The smoke used a separate pr2-backend-smoke dev owner and did not restart or reconfigure the server.

Native workers use pi's background anchor and durable reporter pattern. Kiko retains the application projection for concurrency slots, worker status, changed paths, report formatting/deduplication and crash-resume limits. pi background support is present; ordinary waitForIdle ignores background anchors, so worker lifetime is held through explicit task waiting. The old retained watcher/settle loop is removed. Full worker lifecycle checks are still required before claiming completion.

File integration runs exposed json_each table-function rewriting and the Cloudflare LIKE pattern length limit in scope discovery. Both are fixed. Later file reruns timed out during Miniflare setup under shared-host memory pressure and provide no assertion evidence. The passing earlier focused SQL test covers aliases, overlapping column/table names, FTS external content and triggers, table_info, catalog predicates and isolated erase.
