# Auth review after PR 10

Reviewed PR #10 (`68d840b5`) and the original `origin/fix/clerk-backend-owner` (`bd69743d`). Main contains the complete original branch, followed by the 0.4.5 version bump and PR #10.

## Findings and actions

- Revert PR #10. Clearing `kiko:backend` in generic session cleanup also clears the address that the installer just saved. Installed-backend adoption calls this cleanup, then sends its Clerk exchange to `/api/auth/clerk` on the front door. A URL assertion fails on PR #10 and passes after the revert.
- The same reset breaks access-code configurations that use a stored backend address. Logout must clear credentials without forgetting that configured destination. A regression now checks the next access-code request's actual URL.
- Correct an edge case in the original fix. Pending warm-cache deletion existed only in memory. If IndexedDB deletion failed and the page reloaded, the next account could adopt the shared local `owner` database without retrying cleanup. Persist pending user IDs before removing the old session, reload that record, and drain it before session adoption. If the browser cannot persist the record, refuse the identity transition.

The cleanup regression executes the actual session module in separate processes to model reload. It fails on the original branch and passes with the correction. It also verifies successful retry after the blocker disappears, storage-write refusal, access-code adoption, and boot-time adoption.

## Review and verification

Independent reviewers reproduced both PR #10 regressions and the original branch's cleanup failure. Final independent review approved the correction without another concrete blocker. The installer ownership checks remain intact. No additional installer blocker was found in the focused audit.

All 15 local check steps passed. The final focused session/reload/installer run passed 57 tests. Latest client typecheck, production build, bundle budgets, and lint were checked separately after the cleanup correction. Release workflow verification and live version confirmation are required before reporting deployment complete.

External Clerk and backend responses are mocked in regression tests. This review does not claim a live Google OAuth or Cloudflare installation with another person's account.
