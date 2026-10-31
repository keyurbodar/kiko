set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
xdotool windowfocus "$(window_named "$pid" "Release Checklist")"
xdotool mousemove 60 66 sleep 0.1 click 1
xdotool mousemove 60 106 sleep 0.1 click 1
xdotool mousemove 60 146 sleep 0.1 click 1
xdotool mousemove 110 218 sleep 0.1 click 1
wait_state "$workdir/app-state.json" '.approved == true'
