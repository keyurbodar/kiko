# Bug hunt (shared brief for H1 to H3)

Read issues/STANDING.md and AGENTS.md first. yuki is now single-owner and self-deployed (issues/SO.md).

Find and fix real bugs in your area only. A bug counts only if it is high or medium severity. That means a real owner would hit it in normal use, and it loses data, breaks a feature, wedges an agent, burns Durable Object rows or model tokens at scale, or leaks a key. Skip rare races, theoretical edge cases, style, micro-optimizations, and anything that matters about 1% of the time. If you are unsure whether it is real, reproduce it. No repro means no bug.

Loop: hunt, then for each bug write a failing test, fix it, and see the test pass. Commit after each fix. Then hunt again. Stop when a full pass finds zero bugs at this bar. Timebox: 40 minutes.

Verification follows STANDING rule 9 and runs through /home/keyur/kiko/issues/bin/heavy.sh. Start with `git merge main`.

Report in the STANDING shape, plus `BUGS`: each bug with severity, file:line, user impact, and the test that proved it. End with `ZERO-PASS: yes` or `no`.
