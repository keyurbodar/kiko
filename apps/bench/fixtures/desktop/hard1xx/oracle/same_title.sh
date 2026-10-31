set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
code=$(jq -r .code "$workdir/request.json")
target=$(window_right_of "$pid" "Bench Fixture" 300)
eval "$(xdotool getwindowgeometry --shell "$target")"
xdotool windowfocus "$target"
xdotool mousemove $((X + 160)) $((Y + 68)) sleep 0.1 click 1 sleep 0.1
xdotool type --delay 15 --clearmodifiers -- "$code"
xdotool mousemove $((X + 80)) $((Y + 138)) sleep 0.1 click 1
wait_state "$workdir/state.json" '.target_code != null'
