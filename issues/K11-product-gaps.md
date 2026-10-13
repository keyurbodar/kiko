# K11 product gaps: skills, reminders, errors, skeletons

GOAL: the capabilities the backend already has are visible, and no failure looks like an empty screen.

CONTEXT: `issues/REDESIGN.md` item 10, `refs/reports/R8-frontend-audit.md` (the audit lists each gap with file and line), `refs/reports/R5-agent-surfaces.md`.

DEPENDS ON: K13 and K06 on main (the skills route exists).

SCOPE: `apps/web-solid/src/settings/**`, the skills, reminders and routines surfaces, list and loading components, `apps/web-solid/src/lib/**` for load state. Server only if a read route is missing; say so first.

ACCEPTANCE:
- Skills page lists the built-in skills from the route.
- Workers and reminders each get a surface (list, state, stop or delete where the backend supports it).
- A failed load shows an error with a Retry button, never an empty list. Loading shows a Skeleton from the shared wrapper, no layout shift.
- Empty states say what to do next, in sentence case, once, without decoration.
- Settings pages follow t3's settings layout (compact rows, label left, control right, grouped cards) and the keyboard map works in them.
- Every list and menu is reachable and operable with the keyboard; focus rings visible.

VERIFY: typecheck, web-solid tests, check-imports; browser screenshots under `.verify-evidence/K11/` of each page in loading, error (kill the server to show it), empty and filled states, dark first then light.
