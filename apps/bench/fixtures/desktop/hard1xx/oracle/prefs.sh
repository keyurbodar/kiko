set -euo pipefail
source "$(dirname "$0")/lib.sh"
workdir=$1
pid=$(cat "$workdir/app.pid")
dark=$(jq -r .dark "$workdir/request.json")
font=$(jq -r .font "$workdir/request.json")
xdotool windowfocus "$(window_named "$pid" "Bench Fixture")"
xdotool mousemove 120 78 sleep 0.1 click 1
panel=$(window_named "$pid" "Preferences")
eval "$(xdotool getwindowgeometry --shell "$panel")"
xdotool windowfocus "$panel"
if [ "$dark" = "true" ]; then
  xdotool mousemove $((X + 60)) $((Y + 65)) sleep 0.1 click 1
fi
xdotool mousemove $((X + 90)) $((Y + 148)) sleep 0.1 click 1 sleep 0.1
xdotool key --clearmodifiers ctrl+a
xdotool type --delay 20 --clearmodifiers -- "$font"
xdotool mousemove $((X + 90)) $((Y + 218)) sleep 0.1 click 1
wait_state "$workdir/state.json" '.applied != null'
