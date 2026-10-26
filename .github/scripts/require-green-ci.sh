#!/usr/bin/env bash
set -euo pipefail
sha="$1"
for _ in $(seq 1 90); do
  conclusion="$(gh api "repos/$GITHUB_REPOSITORY/commits/$sha/check-runs?check_name=Check" --jq '[.check_runs[] | select(.app.slug == "github-actions")] | sort_by(.started_at) | last | (.status + ":" + (.conclusion // ""))' || true)"
  case "$conclusion" in
    completed:success) echo "ci passed on $sha"; exit 0 ;;
    completed:*) echo "ci did not pass on $sha ($conclusion). Fix main before releasing." >&2; exit 1 ;;
    *) echo "waiting for ci on $sha (${conclusion:-not started})"; sleep 20 ;;
  esac
done
echo "ci did not finish on $sha within 30 minutes" >&2
exit 1
