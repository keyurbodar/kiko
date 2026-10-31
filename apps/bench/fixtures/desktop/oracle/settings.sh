set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
win=$(window_named "$(cat "$workdir/app.pid")" "Bench Fixture")
xdotool windowfocus "$win"
window_origin "$win"
if [ "$(jq -r .notifications "$workdir/request.json")" = "true" ]; then xdotool mousemove $((X + 70)) $((Y + 65)) sleep 0.1 click 1 sleep 0.2; fi
if [ "$(jq -r .updates "$workdir/request.json")" = "true" ]; then xdotool mousemove $((X + 70)) $((Y + 135)) sleep 0.1 click 1 sleep 0.2; fi
xdotool mousemove $((X + 110)) $((Y + 218)) sleep 0.1 click 1
wait_state "$workdir/state.json" ".applied != null"
