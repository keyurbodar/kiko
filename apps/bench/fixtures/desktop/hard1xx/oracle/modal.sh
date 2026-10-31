set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
name=$(jq -r .name "$workdir/request.json")
email=$(jq -r .email "$workdir/request.json")
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
xdotool mousemove 240 68 sleep 0.1 click 1 sleep 0.1
xdotool type --delay 15 --clearmodifiers -- "$name"
xdotool key --clearmodifiers Tab
session=$(window_named "$pid" "Session")
xdotool windowfocus "$session"
sleep 0.4
xdotool key --clearmodifiers Return
sleep 0.4
xdotool mousemove 240 148 sleep 0.1 click 1 sleep 0.1
xdotool type --delay 15 --clearmodifiers -- "$email"
xdotool mousemove 110 208 sleep 0.1 click 1
wait_state "$workdir/state.json" '.email != null'
