set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
xdotool windowfocus "$(window_named "$pid" "Sync Console")"
xdotool mousemove 110 168 sleep 0.1 click 1
wait_state "$workdir/app-state.json" '.fixed == true'
