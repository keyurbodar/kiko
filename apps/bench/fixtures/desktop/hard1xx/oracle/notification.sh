set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
name=$(jq -r .name "$workdir/request.json")
email=$(jq -r .email "$workdir/request.json")
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
notice=$(window_named "$pid" "New message")
eval "$(xdotool getwindowgeometry --shell "$notice")"
xdotool windowactivate "$notice" || true
xdotool windowraise "$notice" || true
sleep 0.3
xdotool mousemove $((X + 90)) $((Y + 78)) sleep 0.1 click 1
sleep 0.4
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
xdotool mousemove 240 68 sleep 0.1 click 1 sleep 0.1
xdotool type --delay 15 --clearmodifiers -- "$name"
xdotool mousemove 240 148 sleep 0.1 click 1 sleep 0.1
xdotool type --delay 15 --clearmodifiers -- "$email"
xdotool mousemove 110 208 sleep 0.1 click 1
wait_state "$workdir/state.json" '.email != null'
