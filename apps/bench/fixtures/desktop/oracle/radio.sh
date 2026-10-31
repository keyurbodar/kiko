set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
xdotool windowfocus "$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")"
plan=$(jq -r .plan "$workdir/request.json")
index=$(jq -r --arg plan "$plan" '.plans | index($plan)' "$workdir/data.json")
xdotool mousemove 160 $((66 + 44 * index)) sleep 0.1 click 1 sleep 0.2
xdotool mousemove 110 238 sleep 0.1 click 1
wait_state "$workdir/state.json" ".plan == $(jq -n --arg v "$plan" '$v')"
