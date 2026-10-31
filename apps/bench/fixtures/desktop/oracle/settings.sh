set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
xdotool windowfocus "$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")"
if [ "$(jq -r .notifications "$workdir/request.json")" = "true" ]; then xdotool mousemove 70 65 sleep 0.1 click 1 sleep 0.2; fi
if [ "$(jq -r .updates "$workdir/request.json")" = "true" ]; then xdotool mousemove 70 135 sleep 0.1 click 1 sleep 0.2; fi
xdotool mousemove 110 218 sleep 0.1 click 1
wait_state "$workdir/state.json" ".applied != null"
