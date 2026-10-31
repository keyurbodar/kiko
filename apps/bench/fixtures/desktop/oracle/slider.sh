set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
xdotool windowfocus "$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")"
value=$(jq -r .value "$workdir/request.json")
xdotool mousemove 200 70 sleep 0.1 click 1 sleep 0.2
xdotool key Home sleep 0.2
xdotool key --repeat "$value" Right sleep 0.2
xdotool mousemove 110 148 sleep 0.1 click 1
wait_state "$workdir/state.json" ".value == $value"
