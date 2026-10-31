set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
name=$(jq -r .name "$workdir/request.json")
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
xdotool mousemove 120 138 sleep 0.1 click 1
window_named "$pid" "Save As" >/dev/null
sleep 0.5
xdotool key --clearmodifiers ctrl+l
sleep 0.2
xdotool type --delay 15 --clearmodifiers -- "$workdir/archive/$name"
sleep 0.2
xdotool key Return
sleep 0.5
xdotool key Return
wait_state "$workdir/state.json" '.saved_path != null'
