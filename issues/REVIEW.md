# Thermo-nuclear review of the overnight S+ program

Read-only. Do not edit any file, do not commit, do not start servers. Return findings in your final message only.

Scope: the diff `git diff eb015954 main -- <your paths>` in /home/keyur/kiko (the S+ program, U01 to U54). Read the unit reports in `issues/U*.md` for intent. AGENTS.md rules are hard constraints.

Two jobs, both required:

1. **Correctness.** For each behavior the unit reports claim in your area, confirm the code does it. Name every claim the code contradicts, with file:line and the claim's source (issue file). Example to check: U26 claims one-off reminders are capped and snooze is restricted.
2. **Code quality, thermo-nuclear bar.** Be ambitious. Look for code-judo moves that delete whole branches, helpers, modes or layers while keeping behavior. Flag aggressively: complexity a reframing would delete; new ad-hoc conditionals in unrelated flows; flags, nullable modes, one-off booleans; thin wrappers and pass-through helpers; casts, `any`, `unknown`, needless optionality; feature logic in shared or wrong-layer code (core packages must not know yuki); duplicated helpers where a canonical one exists; files pushed past 1000 lines; non-atomic multi-step updates; serialized independent work; tests that only prove code runs.

Do not list cosmetic nits. Prefer few high-conviction findings.

Output, for each finding:
- `ID` (area letter plus number), `severity` (blocker, high, medium), `kind` (correctness or quality)
- `where` file:line
- `what` one or two sentences
- `fix` the concrete restructuring, with what it deletes, sized (lines, files)
- `proof` how to show it (a failing test, a grep, a command)

End with a one-paragraph verdict for your area: approve or not, and the single most valuable change.
