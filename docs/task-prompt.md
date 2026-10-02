# Task session prompt

Paste the block below into a new session and attach one issue file from `issues/`. In Claude Code, `/task P0-05` does the same thing without the attachment.

```text
Do the task in the attached issue file. The issue is the whole assignment and AGENTS.md has the rules. Work through these steps in order.

1. Read the issue, then docs/overview.md, then only what the issue's "Read first" names. Do not read all of docs/architecture.md.
2. Check the dependencies. Run `git fetch origin`. For each id in "Depends on", `git log origin/main --oneline | grep <id>` must find a commit. If one is missing, stop and tell me which.
3. If "Needs a human step" is yes, tell me now exactly what you need from me, then continue with everything that does not need it.
4. Branch from the latest origin/main with the branch name in the issue. If the issue says it needs a worktree and you are not already in one, create one.
5. Build what "Build" lists, inside the files "Files" lists.
6. Run the "Verification" line and check "Done when" against the real thing. Run `bun run typecheck` and `bun test` too. Show me the output.
7. Commit, push, and open a pull request to main. The title is "<id> <task title>". The body says what changed, why, the verification output, and anything you left open.
8. Stop. Do not start another task.

Stop and report instead of working around it when the issue disagrees with the code on main, when you need a file outside "Files", or when verification will not pass. Never weaken the verification to make it pass.
```
